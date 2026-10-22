'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractUrl } = require('../src/main/tunnel');

test('finds the quick tunnel URL in a log line', () => {
  const line = '2026-10-22T13:00:00Z INF |  https://involvement-blues-amounts-morgan.trycloudflare.com  |';
  assert.equal(extractUrl(line), 'https://involvement-blues-amounts-morgan.trycloudflare.com');
});

test('ignores unrelated links', () => {
  assert.equal(extractUrl('see https://github.com/cloudflare/cloudflared'), null);
  assert.equal(extractUrl('no links here'), null);
  assert.equal(extractUrl(''), null);
});
