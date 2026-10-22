'use strict';

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

const file = () => path.join(paths.dataDir(), 'startup.log');

/**
 * Startup trace. A packaged Electron app that dies before the window appears leaves
 * almost no trace on Windows, so every phase is written here first — it is the only
 * reliable way to diagnose "process starts and closes" reports.
 */
function log(step, extra) {
  const line = `${new Date().toISOString()} ${step}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`;
  try {
    const target = file();
    if (fs.existsSync(target) && fs.statSync(target).size > 256 * 1024) {
      fs.writeFileSync(target, '');
    }
    fs.appendFileSync(target, line, 'utf8');
  } catch {
    /* logging must never break startup */
  }
  if (process.env.PCBRIDGE_DEBUG) process.stdout.write(line);
}

/** Installs last-resort handlers: write the error, then show a native box. */
function installCrashHandlers() {
  const report = (kind, error) => {
    log(`fatal:${kind}`, { message: error?.message, stack: String(error?.stack || '').slice(0, 4000) });
    try {
      const { dialog } = require('electron');
      dialog.showErrorBox(
        'PC-Bridge — ошибка запуска',
        `${error?.message || error}\n\nПодробности: ${file()}`,
      );
    } catch {
      /* no GUI yet */
    }
  };
  process.on('uncaughtException', (error) => report('uncaughtException', error));
  process.on('unhandledRejection', (error) => report('unhandledRejection', error));
}

module.exports = { log, installCrashHandlers, file };
