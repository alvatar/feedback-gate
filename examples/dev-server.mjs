import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { cwd } from 'node:process';

import { InMemoryRateLimiter, handleFeedbackRequest } from '../cloudflare/feedback-core.mjs';

const PORT = Number.parseInt(process.env.PORT ?? '4173', 10);
const ROOT = cwd();
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};
const APPS_SCRIPT_SECRET = 'dev-apps-script-secret';
const rateLimiter = new InMemoryRateLimiter();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host || `127.0.0.1:${PORT}`}`);

    if (url.pathname === '/api/feedback') {
      const response = await handleFeedbackRequest(await toRequest(req, url), {
        ALLOWED_ORIGINS: `http://127.0.0.1:${PORT},http://localhost:${PORT}`,
        TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
        APPS_SCRIPT_URL: `http://127.0.0.1:${PORT}/api/apps-script`,
        APPS_SCRIPT_SECRET: APPS_SCRIPT_SECRET,
        RATE_LIMIT_MAX: '5',
        RATE_LIMIT_WINDOW_SEC: '300',
      }, {
        rateLimiter,
      });
      await sendWebResponse(res, response);
      return;
    }

    if (url.pathname === '/api/apps-script') {
      const response = await handleAppsScriptMock(await toRequest(req, url));
      await sendWebResponse(res, response);
      return;
    }

    await sendStaticFile(url.pathname, res);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`feedback-gate dev server: http://127.0.0.1:${PORT}/examples/demo.html`);
});

async function handleAppsScriptMock(request) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed.' }, 405);
  }

  const url = new URL(request.url);
  if (url.searchParams.get('secret') !== APPS_SCRIPT_SECRET) {
    return json({ ok: false, error: 'Invalid secret.' }, 403);
  }

  const payload = await request.json();
  if (!payload || typeof payload.message !== 'string' || payload.message.trim() === '') {
    return json({ ok: false, error: 'Message is required.' }, 400);
  }

  return json({
    ok: true,
    stored: true,
    notified: true,
    receivedAt: new Date().toISOString(),
    payload,
  });
}

async function sendStaticFile(pathname, res) {
  const relativePath = pathname === '/' ? 'examples/demo.html' : pathname.replace(/^\//, '');
  const safePath = normalize(relativePath).replace(/^\.{2}(\/|\\|$)/, '');
  const absolutePath = join(ROOT, safePath);
  const data = await readFile(absolutePath);
  const mimeType = MIME_TYPES[extname(absolutePath)] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mimeType });
  res.end(data);
}

async function toRequest(req, url) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return new Request(url, {
    method: req.method,
    headers,
    body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
  });
}

async function sendWebResponse(res, response) {
  const headers = Object.fromEntries(response.headers.entries());
  res.writeHead(response.status, headers);
  const arrayBuffer = await response.arrayBuffer();
  res.end(Buffer.from(arrayBuffer));
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
