'use strict';

const fs = require('node:fs');
const { EventEmitter } = require('node:events');

const MAX_ENTRIES = 2000;

const GLYPHS = {
  stage: '▸',
  step: '→',
  result: '✓',
  error: '✕',
  note: '·',
  shell: '$',
  gui: '⌘',
  tunnel: '≈',
  ui: '◌',
  key: '⚿',
  admin: '!',
  agent: '•',
  relay: '≈',
};

/**
 * Append-only chronological work log: mirrored into the UI, to a file on disk and to
 * the assistant through `GET /journal`.
 *
 * Notes are structured (`stage` / `step` / `result` / `error`), so the window reads
 * like a build log: a stage header, indented steps, then results and failures.
 */
class Journal extends EventEmitter {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.entries = [];
    this.sequence = 0;
    this.stage = null;
  }

  /**
   * @param {string} kind  stage | step | result | error | note | shell | gui | tunnel | ui
   * @param {string} text  human readable line, never a secret
   */
  push(kind, text, options = {}) {
    const clean = String(text ?? '')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1500);
    if (!clean) return null;

    this.sequence += 1;
    const now = new Date();
    const entry = {
      seq: this.sequence,
      time: now.toTimeString().slice(0, 8),
      date: now.toISOString().slice(0, 10),
      kind,
      glyph: GLYPHS[kind] || '·',
      text: clean,
    };

    if (kind === 'stage') {
      this.stage = clean;
      entry.text = options.index === false ? clean : clean;
    } else if (options.index !== false) {
      entry.text = `${String(this.sequence).padStart(2, '0')} · ${clean}`;
    }

    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();

    try {
      fs.appendFileSync(this.filePath, `[${entry.date} ${entry.time}] [${kind}] ${clean}\n`, 'utf8');
    } catch {
      /* a missing log file must never break the bridge */
    }

    this.emit('entry', entry);
    return entry;
  }

  /** Notes coming from the assistant: `stage`, `step`, `result`, `error`, `note`. */
  note(text, kind = 'note') {
    const allowed = ['stage', 'step', 'result', 'error', 'note'];
    return this.push(allowed.includes(kind) ? kind : 'note', text);
  }

  recent(limit = 200) {
    return this.entries.slice(-limit);
  }
}

module.exports = { Journal, GLYPHS };
