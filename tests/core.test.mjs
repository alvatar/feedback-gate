import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FeedbackGateError,
  buildEndpointUrl,
  createSubmissionPayload,
  prepareSubmission,
  submitFeedback,
} from '../dist/index.js';

test('createSubmissionPayload builds the expected shape', async () => {
  const payload = await createSubmissionPayload({
    message: 'A useful report',
    fields: {
      type: 'bug',
      severity: 'high',
    },
    user: {
      id: 'u_123',
      email: 'user@example.com',
      provider: 'google',
    },
    context: {
      site: 'example.com',
      page: '/pricing',
      meta: { env: 'prod' },
      getMeta: () => ({ locale: 'en-US' }),
    },
    userAgent: 'test-agent',
  });

  assert.equal(payload.site, 'example.com');
  assert.equal(payload.page, '/pricing');
  assert.equal(payload.message, 'A useful report');
  assert.deepEqual(payload.fields, { type: 'bug', severity: 'high' });
  assert.deepEqual(payload.user, {
    id: 'u_123',
    email: 'user@example.com',
    provider: 'google',
  });
  assert.deepEqual(payload.meta, {
    userAgent: 'test-agent',
    env: 'prod',
    locale: 'en-US',
  });
  assert.match(payload.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('prepareSubmission trims message and merges request/auth headers', async () => {
  const prepared = await prepareSubmission({
    message: '  Something broke  ',
    fields: { type: 'bug' },
    requestHeaders: {
      'X-App': 'feedback-gate',
    },
    auth: {
      getUser: () => ({ id: 'abc', email: 'user@example.com' }),
      getHeaders: () => ({ Authorization: 'Bearer token' }),
    },
    context: {
      site: 'example.com',
      page: '/docs',
    },
    userAgent: 'unit-test-agent',
  });

  assert.equal(prepared.payload.message, 'Something broke');
  assert.deepEqual(prepared.payload.user, {
    id: 'abc',
    email: 'user@example.com',
  });
  assert.equal(prepared.headers.Accept, 'application/json');
  assert.equal(prepared.headers['Content-Type'], 'application/json');
  assert.equal(prepared.headers['X-App'], 'feedback-gate');
  assert.equal(prepared.headers.Authorization, 'Bearer token');
});

test('prepareSubmission uses the explicit user when provided', async () => {
  const prepared = await prepareSubmission({
    message: 'Identity should come from the caller',
    fields: {},
    user: {
      id: 'provider-user-1',
      provider: 'google',
      name: 'Visible Name',
    },
    auth: {
      required: true,
      getUser: () => ({
        id: 'different-user',
        email: 'wrong@example.com',
      }),
    },
  });

  assert.deepEqual(prepared.payload.user, {
    id: 'provider-user-1',
    provider: 'google',
    name: 'Visible Name',
  });
});

test('prepareSubmission rejects missing message', async () => {
  await assert.rejects(
    prepareSubmission({
      message: '   ',
      fields: {},
    }),
    (error) => {
      assert.ok(error instanceof FeedbackGateError);
      assert.equal(error.message, 'Message is required.');
      return true;
    },
  );
});

test('prepareSubmission rejects missing required auth user', async () => {
  await assert.rejects(
    prepareSubmission({
      message: 'Needs auth',
      fields: {},
      auth: {
        required: true,
        getUser: () => null,
      },
    }),
    (error) => {
      assert.ok(error instanceof FeedbackGateError);
      assert.equal(error.message, 'Authentication is required before submitting feedback.');
      return true;
    },
  );
});

test('buildEndpointUrl appends query parameters', () => {
  assert.equal(
    buildEndpointUrl('https://example.com/feedback', {
      secret: 'abc',
      origin: 'https://app.example.com',
    }),
    'https://example.com/feedback?secret=abc&origin=https%3A%2F%2Fapp.example.com',
  );

  assert.equal(
    buildEndpointUrl('/feedback', {
      secret: 'abc',
    }),
    '/feedback?secret=abc',
  );
});

test('submitFeedback sends JSON payload', async () => {
  let capturedUrl = '';
  let capturedInit = null;

  const response = await submitFeedback({
    endpoint: 'https://example.com/feedback',
    query: {
      secret: 'abc',
    },
    payload: {
      timestamp: '2026-03-26T12:00:00.000Z',
      site: 'example.com',
      page: '/pricing',
      message: 'Hello',
      fields: { type: 'idea' },
      user: null,
      meta: { userAgent: 'node-test' },
    },
    headers: {
      'Content-Type': 'application/json',
    },
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(response.status, 200);
  assert.equal(capturedUrl, 'https://example.com/feedback?secret=abc');
  assert.equal(capturedInit.method, 'POST');
  assert.equal(capturedInit.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(capturedInit.body), {
    timestamp: '2026-03-26T12:00:00.000Z',
    site: 'example.com',
    page: '/pricing',
    message: 'Hello',
    fields: { type: 'idea' },
    user: null,
    meta: { userAgent: 'node-test' },
  });
});

test('submitFeedback surfaces response body on failure', async () => {
  await assert.rejects(
    submitFeedback({
      endpoint: 'https://example.com/feedback',
      payload: {
        timestamp: '2026-03-26T12:00:00.000Z',
        site: 'example.com',
        page: '/pricing',
        message: 'Hello',
        fields: {},
        user: null,
        meta: {},
      },
      headers: {},
      fetchImpl: async () =>
        new Response('rate limited', {
          status: 429,
        }),
    }),
    /rate limited/,
  );
});
