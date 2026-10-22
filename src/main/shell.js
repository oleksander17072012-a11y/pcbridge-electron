'use strict';

/**
 * Command runner for the shell endpoint.
 *
 * The denylist is a guard rail, not a sandbox: it catches the obvious destructive
 * typos, nothing more. Anything consequential must be confirmed by the user.
 */
const DENYLIST = [
  'format ',
  'rd /s /q c:',
  'del /s /q c:',
  'shutdown /s',
  'shutdown /r',
  'diskpart',
  'bcdedit',
  'cipher /w:',
  'vssadmin delete',
  'wbadmin delete',
  'reg delete hklm',
];

function blockedBy(command) {
  const lowered = String(command || '').toLowerCase();
  return DENYLIST.find((item) => lowered.includes(item)) || null;
}

/**
 * Runs a command and resolves with `{ output, exitCode }`.
 * The child is killed as a process tree when the timeout expires.
 */
function runCommand(command, shell, timeoutSeconds, spawn) {
  const blocked = blockedBy(command);
  if (blocked) {
    return Promise.resolve({
      output: `[BLOCKED by safety denylist] command contains '${blocked.trim()}'`,
      exitCode: 126,
    });
  }

  const isPowerShell = shell === 'powershell' || shell === 'pwsh';
  const file = isPowerShell ? 'powershell' : 'cmd.exe';
  const args = isPowerShell
    ? ['-NoProfile', '-NonInteractive', '-Command', command]
    : ['/c', command];
  const options = { windowsHide: true, timeout: Math.max(1, timeoutSeconds) * 1000 };

  return new Promise((resolve) => {
    const child = spawn(file, args, options);
    let output = '';
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    const collect = (chunk) => {
      output += chunk.toString();
      if (output.length > 20000) output = output.slice(-20000);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    // The timeout resolves immediately: waiting for the kill to be acknowledged can
    // hang forever if the child ignores signals or never emits `close`.
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* already gone */
      }
      finish({
        output: `${output}\n[timeout after ${timeoutSeconds}s — command killed]`,
        exitCode: 124,
      });
    }, Math.max(1, timeoutSeconds) * 1000);

    child.on('error', (error) => {
      finish({ output: `[error] ${error.message}`, exitCode: 1 });
    });

    child.on('close', (code) => {
      finish({ output, exitCode: code ?? -1 });
    });
  });
}

module.exports = { runCommand, blockedBy, DENYLIST };
