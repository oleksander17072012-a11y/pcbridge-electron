'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Journal } = require('../src/main/journal');

function tempJournal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbridge-'));
  return new Journal(path.join(dir, 'log.txt'));
}

test('stage starts a block and is remembered as the current stage', () => {
  const journal = tempJournal();
  const entry = journal.push('stage', 'Этап 1 — проверяю рабочий стол');
  assert.equal(entry.kind, 'stage');
  assert.equal(entry.text, 'Этап 1 — проверяю рабочий стол');
  assert.equal(journal.stage, 'Этап 1 — проверяю рабочий стол');
});

test('steps and results are numbered and get their own glyphs', () => {
  const journal = tempJournal();
  journal.push('stage', 'Этап 1');
  const step = journal.push('step', 'Создаю папку');
  const result = journal.push('result', 'Создана папка');
  assert.match(step.text, /^\d+ · Создаю папку$/);
  assert.equal(step.glyph, '→');
  assert.equal(result.glyph, '✓');
});

test('notes reject unknown kinds and collapse whitespace', () => {
  const journal = tempJournal();
  const entry = journal.note('  привет\n\nмир  ', 'nonsense');
  assert.equal(entry.kind, 'note');
  assert.equal(entry.text, '01 · привет мир');
});

test('entries are mirrored into the log file', () => {
  const journal = tempJournal();
  journal.push('shell', '$ dir');
  const contents = fs.readFileSync(journal.filePath, 'utf8');
  assert.match(contents, /\[shell\] \$ dir/);
});

test('empty entries are ignored', () => {
  const journal = tempJournal();
  assert.equal(journal.push('note', '   '), null);
  assert.equal(journal.sequence, 0);
});

test('history is capped and recent() returns the tail', () => {
  const journal = tempJournal();
  for (let index = 0; index < 2100; index += 1) journal.push('note', `line ${index}`);
  assert.equal(journal.entries.length, 2000);
  const tail = journal.recent(5);
  assert.equal(tail.length, 5);
  assert.match(tail[4].text, /line 2099/);
});
