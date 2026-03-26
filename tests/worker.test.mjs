import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryRateLimiter,
  buildCorsHeaders,
  forwardToAppsScript,
  handleFeedbackRequest,
  isHostAllowed,
  matchesOriginPattern,
  normalizeEnvelope,
  normalizeHosts,
  normalizeOrigins,
  resolveAllowedOrigin,
  validateEnvelope,
} from '../cloudflare/feedback-core.mjs';
import { createRateLimiter } from '../cloudflare/worker.mjs';

test('normalizeOrigins splits comma-separated values', () => {
  assert.deepEqual(normalizeOrigins('https://a.example, https://b.example ,, '), [
    'https://a.example',
    'https://b.example',
  ]);
});

test('normalizeHosts splits comma-separated values and lowercases them', () => {
  assert.deepEqual(normalizeHosts('Feedback.Impactmesh.xyz, api.example.com ,, '), [
    'feedback.impactmesh.xyz',
    'api.example.com',
  ]);
});

test('isHostAllowed enforces exact host allowlists', () => {
  assert.equal(isHostAllowed('feedback.impactmesh.xyz', ['feedback.impactmesh.xyz']), true);
  assert.equal(isHostAllowed('feedback-gate.alvatar.workers.dev', ['feedback.impactmesh.xyz']), false);
  assert.equal(isHostAllowed('feedback.impactmesh.xyz', []), true);
});

test('matchesOriginPattern supports exact and wildcard origins', () => {
  assert.equal(matchesOriginPattern('https://app.impactmesh.xyz', 'https://*.impactmesh.xyz'), true);
  assert.equal(matchesOriginPattern('https://foo.bar.impactmesh.xyz', 'https://*.impactmesh.xyz'), true);
  assert.equal(matchesOriginPattern('https://impactmesh.xyz', 'https://*.impactmesh.xyz'), false);
  assert.equal(matchesOriginPattern('http://app.impactmesh.xyz', 'https://*.impactmesh.xyz'), false);
  assert.equal(matchesOriginPattern('https://app.impactmesh.xyz:8443', 'https://*.impactmesh.xyz'), false);
  assert.equal(matchesOriginPattern('https://app.impactmesh.xyz:8443', 'https://*.impactmesh.xyz:8443'), true);
  assert.equal(matchesOriginPattern('https://app.example.com', 'https://app.example.com'), true);
});

test('resolveAllowedOrigin echoes wildcard-matched request origin', () => {
  assert.equal(
    resolveAllowedOrigin('https://docs.impactmesh.xyz', ['https://*.impactmesh.xyz']),
    'https://docs.impactmesh.xyz',
  );

  const headers = buildCorsHeaders(
    new Request('https://worker.example/feedback', {
      headers: { Origin: 'https://docs.impactmesh.xyz' },
    }),
    ['https://*.impactmesh.xyz'],
  );

  assert.equal(headers['Access-Control-Allow-Origin'], 'https://docs.impactmesh.xyz');
});

test('normalizeEnvelope unwraps request bodies and raw payloads', () => {
  assert.deepEqual(normalizeEnvelope({ payload: { message: 'x' }, verification: { honeypot: '' } }), {
    payload: { message: 'x' },
    verification: { honeypot: '' },
  });

  assert.deepEqual(normalizeEnvelope({ message: 'x' }), {
    payload: { message: 'x' },
    verification: {},
  });
});

test('validateEnvelope requires message and rejects honeypot spam', () => {
  assert.equal(validateEnvelope({ payload: { message: 'ok' }, verification: {} }), null);
  assert.equal(validateEnvelope({ payload: { message: '' }, verification: {} }), 'Message is required.');
  assert.equal(
    validateEnvelope({ payload: { message: 'ok' }, verification: { honeypot: 'bot' } }),
    'Spam rejected.',
  );
});

test('forwardToAppsScript appends the shared secret and forwards the payload', async () => {
  let capturedUrl = '';
  let capturedBody = '';

  const response = await forwardToAppsScript({
    appsScriptUrl: 'https://script.google.com/macros/s/demo/exec',
    appsScriptSecret: 'worker-secret',
    payload: { message: 'Hello' },
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedBody = String(init.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  assert.equal(response.status, 200);
  assert.equal(capturedUrl, 'https://script.google.com/macros/s/demo/exec?secret=worker-secret');
  assert.equal(capturedBody, JSON.stringify({ message: 'Hello' }));
});

test('InMemoryRateLimiter rejects after the configured burst', async () => {
  const limiter = new InMemoryRateLimiter();
  const first = await limiter.check({ key: '127.0.0.1', max: 2, windowSec: 60, now: 1000 });
  const second = await limiter.check({ key: '127.0.0.1', max: 2, windowSec: 60, now: 2000 });
  const third = await limiter.check({ key: '127.0.0.1', max: 2, windowSec: 60, now: 3000 });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSec > 0);
});

test('createRateLimiter falls back when durable object binding is missing', async () => {
  const fallback = new InMemoryRateLimiter();
  const limiter = createRateLimiter(undefined, fallback);

  const first = await limiter.check({ key: 'fallback', max: 1, windowSec: 60, now: 1000 });
  const second = await limiter.check({ key: 'fallback', max: 1, windowSec: 60, now: 2000 });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
});

test('createRateLimiter falls back when durable object calls fail', async () => {
  const fallback = new InMemoryRateLimiter();
  const limiter = createRateLimiter(
    {
      idFromName() {
        return 'id';
      },
      get() {
        return {
          async fetch() {
            throw new Error('boom');
          },
        };
      },
    },
    fallback,
  );

  const first = await limiter.check({ key: 'broken-do', max: 1, windowSec: 60, now: 1000 });
  const second = await limiter.check({ key: 'broken-do', max: 1, windowSec: 60, now: 2000 });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
});

test('handleFeedbackRequest rate limits and forwards upstream', async () => {
  const upstreamCalls = [];
  const request = new Request('https://worker.example/feedback', {
    method: 'POST',
    headers: {
      Origin: 'https://app.example.com',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.10',
    },
    body: JSON.stringify({
      payload: {
        timestamp: '2026-03-26T12:00:00.000Z',
        site: 'example.com',
        page: '/pricing',
        message: 'Hello',
        fields: { type: 'bug' },
        meta: {},
      },
      verification: {
        honeypot: '',
      },
    }),
  });

  const response = await handleFeedbackRequest(
    request,
    {
      ALLOWED_ORIGINS: 'https://app.example.com',
      APPS_SCRIPT_URL: 'https://script.google.com/macros/s/demo/exec',
      APPS_SCRIPT_SECRET: 'apps-secret',
      RATE_LIMIT_MAX: '5',
      RATE_LIMIT_WINDOW_SEC: '300',
    },
    {
      rateLimiter: new InMemoryRateLimiter(),
      fetchImpl: async (url, init) => {
        upstreamCalls.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ ok: true, stored: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].url, 'https://script.google.com/macros/s/demo/exec?secret=apps-secret');
  assert.equal(upstreamCalls[0].body.message, 'Hello');
  assert.equal(upstreamCalls[0].body.meta.verifiedBy, 'cloudflare-worker');
  assert.equal(upstreamCalls[0].body.meta.verificationMode, 'rate-limit-plus-honeypot');
  assert.match(upstreamCalls[0].body.meta.remoteIpHash, /^[a-f0-9]{64}$/);
});

test('handleFeedbackRequest accepts wildcard impactmesh subdomains', async () => {
  const response = await handleFeedbackRequest(
    new Request('https://feedback.impactmesh.xyz/feedback', {
      method: 'POST',
      headers: {
        Origin: 'https://campaign.impactmesh.xyz',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: { message: 'Hello' }, verification: { honeypot: '' } }),
    }),
    {
      ALLOWED_HOSTS: 'feedback.impactmesh.xyz',
      ALLOWED_ORIGINS: 'https://*.impactmesh.xyz',
      APPS_SCRIPT_URL: 'https://script.google.com/macros/s/demo/exec',
      APPS_SCRIPT_SECRET: 'apps-secret',
    },
    {
      rateLimiter: new InMemoryRateLimiter(),
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true, stored: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://campaign.impactmesh.xyz');
});

test('handleFeedbackRequest rejects requests on disallowed hosts', async () => {
  const response = await handleFeedbackRequest(
    new Request('https://feedback-gate.alvatar.workers.dev/feedback', {
      method: 'POST',
      headers: {
        Origin: 'https://campaign.impactmesh.xyz',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: { message: 'Hello' }, verification: { honeypot: '' } }),
    }),
    {
      ALLOWED_HOSTS: 'feedback.impactmesh.xyz',
      ALLOWED_ORIGINS: 'https://*.impactmesh.xyz',
      APPS_SCRIPT_URL: 'https://script.google.com/macros/s/demo/exec',
      APPS_SCRIPT_SECRET: 'apps-secret',
    },
    {
      rateLimiter: new InMemoryRateLimiter(),
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true, stored: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    },
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: 'Not found.' });
});

test('handleFeedbackRequest rejects invalid origins and honeypot spam', async () => {
  const invalidOriginResponse = await handleFeedbackRequest(
    new Request('https://worker.example/feedback', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: { message: 'Hello' }, verification: { honeypot: '' } }),
    }),
    {
      ALLOWED_ORIGINS: 'https://app.example.com',
      APPS_SCRIPT_URL: 'https://script.google.com/macros/s/demo/exec',
      APPS_SCRIPT_SECRET: 'apps-secret',
    },
    { rateLimiter: new InMemoryRateLimiter(), fetchImpl: async () => new Response('{}', { status: 200 }) },
  );

  assert.equal(invalidOriginResponse.status, 403);

  const honeypotResponse = await handleFeedbackRequest(
    new Request('https://worker.example/feedback', {
      method: 'POST',
      headers: {
        Origin: 'https://app.example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: { message: 'Hello' }, verification: { honeypot: 'bot' } }),
    }),
    {
      ALLOWED_ORIGINS: 'https://app.example.com',
      APPS_SCRIPT_URL: 'https://script.google.com/macros/s/demo/exec',
      APPS_SCRIPT_SECRET: 'apps-secret',
    },
    { rateLimiter: new InMemoryRateLimiter(), fetchImpl: async () => new Response('{}', { status: 200 }) },
  );

  assert.equal(honeypotResponse.status, 400);
});

test('handleFeedbackRequest rejects upstream logical failures', async () => {
  const response = await handleFeedbackRequest(
    new Request('https://worker.example/feedback', {
      method: 'POST',
      headers: {
        Origin: 'https://app.example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: { message: 'Hello' }, verification: { honeypot: '' } }),
    }),
    {
      ALLOWED_ORIGINS: 'https://app.example.com',
      APPS_SCRIPT_URL: 'https://script.google.com/macros/s/demo/exec',
      APPS_SCRIPT_SECRET: 'apps-secret',
    },
    {
      rateLimiter: new InMemoryRateLimiter(),
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: false, error: 'Sheet append failed.' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    },
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Sheet append failed.',
  });
});

test('handleFeedbackRequest rejects invalid upstream success payloads', async () => {
  const response = await handleFeedbackRequest(
    new Request('https://worker.example/feedback', {
      method: 'POST',
      headers: {
        Origin: 'https://app.example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: { message: 'Hello' }, verification: { honeypot: '' } }),
    }),
    {
      ALLOWED_ORIGINS: 'https://app.example.com',
      APPS_SCRIPT_URL: 'https://script.google.com/macros/s/demo/exec',
      APPS_SCRIPT_SECRET: 'apps-secret',
    },
    {
      rateLimiter: new InMemoryRateLimiter(),
      fetchImpl: async () => new Response('<html>oops</html>', { status: 200 }),
    },
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Upstream storage returned an invalid success response.',
  });
});

test('handleFeedbackRequest reports missing upstream config clearly', async () => {
  const response = await handleFeedbackRequest(
    new Request('https://worker.example/feedback', {
      method: 'POST',
      headers: {
        Origin: 'https://app.example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: { message: 'Hello' }, verification: { honeypot: '' } }),
    }),
    {
      ALLOWED_ORIGINS: 'https://app.example.com',
      APPS_SCRIPT_SECRET: 'apps-secret',
    },
    {
      rateLimiter: new InMemoryRateLimiter(),
    },
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'APPS_SCRIPT_URL is missing.',
  });
});
