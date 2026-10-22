'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

test('every element the renderer touches exists in the markup', () => {
  const html = read('src', 'renderer', 'index.html');
  const script = read('src', 'renderer', 'app.js');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const used = new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]));
  const missing = [...used].filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `renderer uses unknown ids: ${missing.join(', ')}`);
});

test('the preload API matches the IPC channels registered in the main process', () => {
  const preload = read('src', 'preload', 'index.js');
  const main = read('src', 'main', 'index.js');

  const exposed = [...preload.matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)].map((match) => match[1]);
  const handlers = [
    ...main.matchAll(/ipcMain\.(?:handle|on)\('([^']+)'/g),
  ].map((match) => match[1]);

  const missing = [...new Set(exposed)].filter((channel) => !handlers.includes(channel));
  assert.deepEqual(missing, [], `channels without a handler: ${missing.join(', ')}`);
});

test('the chat window never gets a preload script', () => {
  const main = read('src', 'main', 'index.js');
  const chatBlock = main.slice(main.indexOf('function openChatInApp'), main.indexOf('// ---------------------------------------------------------------- app lifecycle'));
  assert.ok(chatBlock.includes('partition: \'persist:arena-chat\''), 'chat must use its own persistent partition');
  assert.ok(!chatBlock.includes('preload'), 'the remote origin must not receive the bridge preload');
});

test('the renderer runs with context isolation and without node integration', () => {
  const main = read('src', 'main', 'index.js');
  assert.ok(main.includes('contextIsolation: true'));
  assert.ok(main.includes('nodeIntegration: false'));
});

test('startup trace is installed before any window is created', () => {
  const main = read('src', 'main', 'index.js');
  assert.ok(main.includes('startup.installCrashHandlers()'), 'crash handlers must be installed at require time');
  assert.ok(main.includes("startup.log('app:ready')"));
});

test('tray creation cannot take the app down and the icon ships inside the package', () => {
  const main = read('src', 'main', 'index.js');
  const manifest = JSON.parse(read('package.json'));
  assert.ok(manifest.build.files.includes('build/icon.ico'), 'the tray icon must be packaged');
  assert.ok(main.includes('tray:failed'), 'tray creation must be guarded');
});

test('the window is shown even if ready-to-show never fires', () => {
  const main = read('src', 'main', 'index.js');
  assert.ok(main.includes('window:forced-show'), 'fallback show is required');
});

test('the app manifest requests no elevation: the portable stub must be able to start it', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.build.win.requestedExecutionLevel, 'asInvoker');
});

test('elevation is offered at runtime and can be skipped with a flag', () => {
  const main = read('src', 'main', 'index.js');
  assert.ok(main.includes('offerElevation'), 'the app must offer elevation at startup');
  assert.ok(main.includes('--no-elevate'), 'there must be a way to skip the prompt');
  assert.ok(main.includes("ipcMain.handle('elevate'"), 'manual elevation must be available');
});

test('relaunching elevated uses the original portable executable, not the temp copy', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'main', 'elevation.js'),
    'utf8',
  );
  assert.ok(source.includes('PORTABLE_EXECUTABLE_FILE'));
});
