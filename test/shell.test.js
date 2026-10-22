'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { blockedBy, runCommand } = require('../src/main/shell');

function fakeSpawn(script) {
  const { EventEmitter } = require('node:events');
  return (file, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4242;
    child.kill = () => {};
    setImmediate(() => script(child, file, args));
    return child;
  };
}

test('the denylist catches destructive one-liners', () => {
  assert.equal(blockedBy('format C: /q'), 'format ');
  assert.equal(blockedBy('DISKPART'), 'diskpart');
  assert.equal(blockedBy('echo hello'), null);
});

test('a blocked command never reaches the shell', async () => {
  let spawned = false;
  const result = await runCommand('shutdown /s /t 0', null, 5, () => {
    spawned = true;
    return null;
  });
  assert.equal(spawned, false);
  assert.equal(result.exitCode, 126);
  assert.match(result.output, /BLOCKED/);
});

test('output and exit code are passed through', async () => {
  const spawn = fakeSpawn((child) => {
    child.stdout.emit('data', 'hello ');
    child.stdout.emit('data', 'world');
    child.emit('close', 0);
  });
  const result = await runCommand('echo hello', null, 5, spawn);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, 'hello world');
});

test('timeouts are reported with exit code 124', async () => {
  const spawn = fakeSpawn(() => {
    /* never closes: the timeout must fire */
  });
  const result = await runCommand('ping -t 127.0.0.1', null, 1, spawn);
  assert.equal(result.exitCode, 124);
  assert.match(result.output, /timeout after 1s/);
});
