'use strict';

const http = require('node:http');

const { handleJob } = require('./agent');

/**
 * Loopback HTTP API. Everything the Cloudflare tunnel exposes goes through here, so
 * every endpoint except `/health` requires `Authorization: Bearer <pairing key>`.
 */
function createRelay(ctx) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const authorized = request.headers.authorization === `Bearer ${ctx.getKey()}`;

    const json = (status, payload) => {
      const body = Buffer.from(JSON.stringify(payload));
      response.writeHead(status, {
        'content-type': 'application/json',
        'content-length': body.length,
      });
      response.end(body);
    };

    const readBody = () => new Promise((resolve) => {
      const chunks = [];
      request.on('data', (chunk) => {
        chunks.push(chunk);
        if (Buffer.concat(chunks).length > 64 * 1024) request.destroy();
      });
      request.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch {
          resolve({});
        }
      });
      request.on('error', () => resolve({}));
    });

    if (url.pathname === '/health') {
      return json(200, { ok: true, service: 'pc-bridge', runtime: 'electron', version: ctx.version });
    }
    if (!authorized) return json(403, { error: 'bad token' });

    if (request.method === 'GET') {
      if (url.pathname === '/status') {
        return json(200, {
          ok: true,
          active: ctx.isActive(),
          hostname: ctx.hostname,
          tunnel_url: ctx.getTunnelUrl(),
          uptime_seconds: Math.round((Date.now() - ctx.startedAt) / 1000),
          stage: ctx.journal.stage,
        });
      }
      if (url.pathname === '/windows') {
        return json(200, { windows: ctx.windows() });
      }
      if (url.pathname === '/journal') {
        return json(200, { stage: ctx.journal.stage, entries: ctx.journal.recent(100) });
      }
      // Kept for compatibility with the polling protocol of the Python version.
      if (url.pathname === '/poll') {
        return json(200, { job: null, hostname: ctx.hostname, active: ctx.isActive() });
      }
      return json(404, { error: 'not found' });
    }

    if (request.method === 'POST') {
      const body = await readBody();

      if (url.pathname === '/note') {
        const text = String(body.text ?? '').trim();
        if (!text) return json(400, { error: 'text is required' });
        if (text.length > 2000) return json(413, { error: 'note too long (max 2000 characters)' });
        ctx.countNote();
        const entry = ctx.journal.note(text, body.kind || 'note');
        return json(200, { ok: true, sequence: entry ? entry.seq : null, kind: entry ? entry.kind : null });
      }

      if (url.pathname === '/result') {
        return json(200, { ok: true });
      }

      if (url.pathname === '/cmd') {
        if (!ctx.isActive()) return json(409, { error: 'agent is paused in the launcher' });
        const type = body.type || 'shell';
        if (!['shell', 'screenshot', 'gui'].includes(type)) {
          return json(400, { error: `unknown type: ${type}` });
        }
        ctx.countCommand();
        let answer;
        try {
          answer = await handleJob(body, ctx);
        } catch (error) {
          answer = { output: `[error] ${error.message}`, exit_code: 1 };
        }
        if (body.screenshot_after) {
          const extra = await handleJob({ type: 'screenshot' }, ctx);
          for (const [key, value] of Object.entries(extra)) {
            if (key !== 'exit_code') answer[key] = value;
          }
        }
        return json(200, answer);
      }
      return json(404, { error: 'not found' });
    }

    return json(405, { error: 'method not allowed' });
  });

  return {
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    }),
    close: () => server.close(),
    server,
  };
}

module.exports = { createRelay };
