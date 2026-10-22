'use strict';

const path = require('node:path');
const fs = require('node:fs');

/** All mutable state lives in the user profile, never next to the executable. */
function dataDir() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || require('node:os').tmpdir();
  const dir = path.join(base, 'PC-Bridge');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function binDir() {
  const dir = path.join(dataDir(), 'bin');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  dataDir,
  binDir,
  logPath: () => path.join(dataDir(), 'pc_agent_log.txt'),
  keyPath: () => path.join(dataDir(), 'pairing.key'),
};
