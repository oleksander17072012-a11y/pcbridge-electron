'use strict';

const { spawn } = require('node:child_process');

const win32 = require('./win32');

/**
 * Elevation is a runtime decision, not a manifest requirement.
 *
 * A manifest with `requireAdministrator` looks tempting, but it breaks the portable
 * build: the self-extracting stub starts fine and then cannot launch the inner
 * executable, so the process appears in Task Manager and vanishes without a window.
 * Instead the app always starts as the current user and offers to restart itself
 * elevated — the bridge works either way, admin rights only extend its reach.
 */
function isElevated() {
  try {
    const api = win32.load();
    if (!api || !api.IsUserAnAdmin) return false;
    return api.IsUserAnAdmin() !== 0;
  } catch {
    return false;
  }
}

/** True when the current process can be relaunched with a UAC prompt. */
function canElevate() {
  return process.platform === 'win32';
}

/**
 * Starts a second, elevated copy of the app and leaves the current one to exit.
 * Arguments are forwarded so `--safe`, `--no-elevate` and friends survive the restart.
 */
function relaunchElevated() {
  // In a portable build `process.execPath` points at the copy unpacked to %TEMP%.
  // Relaunching that copy would leave a second, temporary installation behind, so
  // prefer the original portable executable when the builder provides it.
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const args = process.argv.slice(1).filter((argument) => argument !== '--elevated');
  const quoted = args.map((argument) => `'${argument.replace(/'/g, "''")}'`).join(',');
  const script = [
    `Start-Process -FilePath '${exe.replace(/'/g, "''")}'`,
    quoted ? `-ArgumentList ${quoted}` : '',
    "-Verb RunAs",
  ]
    .filter(Boolean)
    .join(' ');

  return new Promise((resolve) => {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (error) => resolve({ ok: false, error: error.message }));
    child.on('spawn', () => resolve({ ok: true }));
  });
}

const ELEVATED_FLAG = '--elevated';

module.exports = { isElevated, canElevate, relaunchElevated, ELEVATED_FLAG };
