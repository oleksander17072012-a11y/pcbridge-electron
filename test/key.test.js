'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { generateKey, pairingBlock } = require('../src/main/key');

test('keys are 32 hex characters and never repeat', () => {
  const first = generateKey();
  const second = generateKey();
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.notEqual(first, second);
});

test('the pairing block has the documented shape', () => {
  const block = pairingBlock({ url: 'https://x.trycloudflare.com', key: 'k'.repeat(32) });
  const lines = block.split('\n');
  assert.equal(lines[0], 'PC-BRIDGE-PAIRING v1');
  assert.equal(lines[1], 'url=https://x.trycloudflare.com');
  assert.equal(lines[2], `key=${'k'.repeat(32)}`);
  assert.match(lines[3], /^created=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('a missing tunnel URL is spelled out instead of leaking "null"', () => {
  assert.match(pairingBlock({ key: 'a'.repeat(32) }), /url=туннель ещё не поднялся/);
});
