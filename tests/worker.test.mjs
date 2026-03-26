import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryRateLimiter,
  forwardToAppsScript,
  handleFeedbackRequest,
  normalizeEnvelope,
  normalizeOrigins,
  validateEnvelope,
  verifyTurnstile,
} from '../cloudflare/feedback-core.mjs';

test('normalizeOrigins splits comma-separated values', () => {
  assert.deepEqual(normalizeOrigins('https://a.example, https://b.example ,, '), [
    'https://a.example',
    'https://b.example',
  ]);
});

test('normalizeEnvelope unwraps request bodies and raw payloads', () => {
  assert.deepEqual(normalizeEnvelope({ payload: { message: 'x' }, verification: { turnstileToken: 't' } }), {
    payload: { message: 'x' },
    verification: { turnstileToken: 't' },
  });

  assert.deepEqual(normalizeEnvelope({ message: 'x' }), {
    payload: { message: 'x' },
    verification: {},
  });
});

test('validateEnvelope requires message and turnstile token', () => {
  assert.equal(
    validateEnvelope({ payload: { message: 'ok' }, verification: { turnstileToken: 'token' } }),
    null,
  );
  assert.equal(validateEnvelope({ payload: { message: '' }, verification: { turnstileToken: 'token' } }), 'Message is required.');
  assert.equal(validateEnvelope({ payload: { message: 'ok' }, verification: {} }), 'Turnstile token is required.');
  assert.equal(
    validateEnvelope({ payload: { message: 'ok' }, verification: { turnstileToken: 'token', honeypot: 'bot' } }),
    'Spam rejected.',
  );
});

test('verifyTurnstile posts to Cloudflare siteverify', async () => {
  let capturedBody = '';

  const result = await verifyTurnstile({
    secretKey: 'secret',
    token: 'token-123',
    remoteIp: '127.0.0.1',
    fetchImpl: async (_url, init) => {
      capturedBody = String(init.body);
      return new Response(
        JSON.stringify({ success: true, action: 'feedback_submit', 'error-codes': [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });

  assert.equal(result.success, true);
  assert.match(capturedBody, /secret=secret/);
  assert.match(capturedBody, /response=token-123/);
  assert.match(capturedBody, /remoteip=127.0.0.1/);
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

test('handleFeedbackRequest verifies Turnstile, rate limits, and forwards upstream', async () => {
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
        user: null,
        meta: {},
      },
      verification: {
        turnstileToken: 'token-123',
        honeypot: '',
      },
    }),
  });

  const response = await handleFeedbackRequest(
    request,
    {
      ALLOWED_ORIGINS: 'https://app.example.com',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
      APPS_SCRIPT_URL: 'https://script.google.com/macros/s/demo/exec',
      APPS_SCRIPT_SECRET: 'apps-secret',
      RATE_LIMIT_MAX: '5',
      RATE_LIMIT_WINDOW_SEC: '300',
    },
    {
      rateLimiter: new InMemoryRateLimiter(),
      fetchImpl: async (url, init) => {
        const target = String(url);
        if (target.includes('siteverify')) {
          return new Response(JSON.stringify({ success: true, action: 'feedback_submit' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        upstreamCalls.push({ url: target, body: JSON.parse(String(init.body)) });
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
  assert.equal(upstreamCalls[0].body.meta.verifiedBy, 'cloudflare-turnstile');
});

test('handleFeedbackRequest rejects invalid origins and missing turnstile tokens', async () => {
  const invalidOriginResponse = await handleFeedbackRequest(
    new Request('https://worker.example/feedback', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: { message: 'Hello' }, verification: { turnstileToken: 'token' } }),
    }),
    {
      ALLOWED_ORIGINS: 'https://app.example.com',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
      APPS_SCRIPT_URL: 'https://script.google.com/macros/s/demo/exec',
      APPS_SCRIPT_SECRET: 'apps-secret',
    },
    { rateLimiter: new InMemoryRateLimiter(), fetchImpl: async () => new Response('{}', { status: 200 }) },
  );

  assert.equal(invalidOriginResponse.status, 403);

  const missingTokenResponse = await handleFeedbackRequest(
    new Request('https://worker.example/feedback', {
      method: 'POST',
      headers: {
        Origin: 'https://app.example.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: { message: 'Hello' }, verification: {} }),
    }),
    {
      ALLOWED_ORIGINS: 'https://app.example.com',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
      APPS_SCRIPT_URL: 'https://script.google.com/macros/s/demo/exec',
      APPS_SCRIPT_SECRET: 'apps-secret',
    },
    { rateLimiter: new InMemoryRateLimiter(), fetchImpl: async () => new Response('{}', { status: 200 }) },
  );

  assert.equal(missingTokenResponse.status, 400);
});
