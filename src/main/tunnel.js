'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const paths = require('./paths');

const DOWNLOAD_URL =
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

/**
 * Cloudflare quick tunnel: downloads `cloudflared` once, verifies its Authenticode
 * signature, keeps the process alive and reports the public URL.
 */
class Tunnel extends require('node:events').EventEmitter {
  constructor(journal) {
    super();
    this.journal = journal;
    this.child = null;
    this.url = null;
    this.port = 0;
    this.stopping = false;
    this.timer = null;
  }

  get binary() {
    return path.join(paths.binDir(), 'cloudflared.exe');
  }

  ensureBinary() {
    if (fs.existsSync(this.binary)) return this.binary;
    this.journal.push('tunnel', 'скачиваю cloudflared (один раз, ~40 МБ)');
    execFileSync('curl.exe', ['-sSL', '--fail', '-o', this.binary, DOWNLOAD_URL], {
      windowsHide: true,
      timeout: 180000,
    });
    if (!this.verifySignature()) {
      fs.rmSync(this.binary, { force: true });
      throw new Error('подпись cloudflared не подтверждена');
    }
    this.journal.push('tunnel', 'cloudflared скачан, подпись проверена');
    return this.binary;
  }

  /** Authenticode check: the binary must be validly signed by Cloudflare. */
  verifySignature() {
    const script = [
      `$s = Get-AuthenticodeSignature -FilePath '${this.binary.replace(/'/g, "''")}';`,
      "if ($s.Status -ne 'Valid') { exit 2 };",
      "if ($s.SignerCertificate.Subject -notmatch 'Cloudflare') { exit 3 };",
      'exit 0',
    ].join(' ');
    try {
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        timeout: 30000,
      });
      return true;
    } catch {
      return false;
    }
  }

  start(port) {
    this.port = port;
    this.stopping = false;
    this.supervise();
  }

  stop() {
    this.stopping = true;
    clearTimeout(this.timer);
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* already gone */
      }
      this.child = null;
    }
  }

  restart(port) {
    this.stop();
    this.url = null;
    this.emit('url', null);
    this.start(port || this.port);
  }

  supervise() {
    if (this.stopping) return;
    try {
      this.ensureBinary();
    } catch (error) {
      this.journal.push('tunnel', `cloudflared недоступен: ${error.message}`);
      this.timer = setTimeout(() => this.supervise(), 15000);
      return;
    }

    this.journal.push('tunnel', 'запускаю туннель cloudflared');
    this.child = spawn(
      this.binary,
      ['tunnel', '--url', `http://127.0.0.1:${this.port}`, '--no-autoupdate'],
      { windowsHide: true },
    );

    const consume = (stream) => {
      let buffered = '';
      stream.on('data', (chunk) => {
        buffered += chunk.toString();
        const lines = buffered.split('\n');
        buffered = lines.pop() || '';
        for (const line of lines) {
          const found = extractUrl(line);
          if (found && found !== this.url) {
            this.url = found;
            this.journal.push('tunnel', `туннель готов: ${found}`);
            this.emit('url', found);
          }
        }
      });
    };
    consume(this.child.stdout);
    consume(this.child.stderr);

    this.child.on('exit', () => {
      this.child = null;
      if (this.stopping) return;
      this.url = null;
      this.emit('url', null);
      this.journal.push('tunnel', 'туннель упал — перезапускаю');
      this.timer = setTimeout(() => this.supervise(), 3000);
    });
  }
}

function extractUrl(line) {
  const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(String(line || ''));
  return match ? match[0] : null;
}

module.exports = { Tunnel, extractUrl, DOWNLOAD_URL };
