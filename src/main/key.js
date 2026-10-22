'use strict';

const crypto = require('node:crypto');

/** 32 hex characters from the OS CSPRNG. */
function generateKey() {
  return crypto.randomBytes(16).toString('hex');
}

/** Pairing block pasted into a chat: URL of the tunnel plus the key. */
function pairingBlock({ url, key, created }) {
  return [
    'PC-BRIDGE-PAIRING v1',
    `url=${url || 'туннель ещё не поднялся'}`,
    `key=${key}`,
    `created=${created || new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
  ].join('\n');
}

module.exports = { generateKey, pairingBlock };
