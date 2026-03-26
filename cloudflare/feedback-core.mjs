const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function handleFeedbackRequest(request, env, deps = {}) {
  const config = normalizeEnvironment(env);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const rateLimiter = deps.rateLimiter ?? null;
  const now = deps.now ?? (() => Date.now());

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(request, config.allowedOrigins),
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      { ok: false, error: 'Method not allowed.' },
      405,
      buildCorsHeaders(request, config.allowedOrigins),
    );
  }

  const origin = request.headers.get('Origin') ?? '';
  if (!isOriginAllowed(origin, config.allowedOrigins)) {
    return jsonResponse(
      { ok: false, error: 'Origin not allowed.' },
      403,
      buildCorsHeaders(request, config.allowedOrigins),
    );
  }

  let envelope;
  try {
    envelope = await request.json();
  } catch {
    return jsonResponse(
      { ok: false, error: 'Invalid JSON body.' },
      400,
      buildCorsHeaders(request, config.allowedOrigins),
    );
  }

  const normalized = normalizeEnvelope(envelope);
  const validationError = validateEnvelope(normalized);
  if (validationError) {
    return jsonResponse(
      { ok: false, error: validationError },
      400,
      buildCorsHeaders(request, config.allowedOrigins),
    );
  }

  const remoteIp = getRemoteIp(request);
  if (rateLimiter) {
    const rateLimit = await rateLimiter.check({
      key: `${origin}:${remoteIp}`,
      max: config.rateLimitMax,
      windowSec: config.rateLimitWindowSec,
      now: now(),
    });

    if (!rateLimit.allowed) {
      return jsonResponse(
        { ok: false, error: 'Too many feedback submissions. Please try again later.' },
        429,
        {
          ...buildCorsHeaders(request, config.allowedOrigins),
          'Retry-After': String(rateLimit.retryAfterSec ?? config.rateLimitWindowSec),
        },
      );
    }
  }

  const turnstile = await verifyTurnstile({
    secretKey: config.turnstileSecretKey,
    token: normalized.verification.turnstileToken,
    remoteIp,
    fetchImpl,
  });

  if (!turnstile.success) {
    return jsonResponse(
      {
        ok: false,
        error: 'Turnstile verification failed.',
        codes: turnstile.errorCodes,
      },
      400,
      buildCorsHeaders(request, config.allowedOrigins),
    );
  }

  const forwardedPayload = {
    ...normalized.payload,
    meta: {
      ...(normalized.payload.meta ?? {}),
      verifiedBy: 'cloudflare-turnstile',
      turnstileAction: turnstile.action ?? '',
    },
  };

  const upstreamResponse = await forwardToAppsScript({
    appsScriptUrl: config.appsScriptUrl,
    appsScriptSecret: config.appsScriptSecret,
    payload: forwardedPayload,
    fetchImpl,
  });

  const responsePayload = await safeParseJson(upstreamResponse);
  if (!upstreamResponse.ok) {
    return jsonResponse(
      {
        ok: false,
        error: responsePayload?.error || `Upstream storage failed with status ${upstreamResponse.status}.`,
      },
      502,
      buildCorsHeaders(request, config.allowedOrigins),
    );
  }

  return jsonResponse(responsePayload ?? { ok: true }, 200, buildCorsHeaders(request, config.allowedOrigins));
}

export function normalizeEnvironment(env) {
  return {
    allowedOrigins: normalizeOrigins(env.ALLOWED_ORIGINS ?? ''),
    turnstileSecretKey: String(env.TURNSTILE_SECRET_KEY ?? '').trim(),
    appsScriptUrl: String(env.APPS_SCRIPT_URL ?? '').trim(),
    appsScriptSecret: String(env.APPS_SCRIPT_SECRET ?? '').trim(),
    rateLimitMax: parsePositiveInteger(env.RATE_LIMIT_MAX, 5),
    rateLimitWindowSec: parsePositiveInteger(env.RATE_LIMIT_WINDOW_SEC, 300),
  };
}

export function normalizeOrigins(value) {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeEnvelope(input) {
  if (input && typeof input === 'object' && 'payload' in input) {
    return {
      payload: input.payload ?? {},
      verification: input.verification ?? {},
    };
  }

  return {
    payload: input ?? {},
    verification: {},
  };
}

export function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return 'Invalid request body.';
  }

  if (!envelope.payload || typeof envelope.payload !== 'object') {
    return 'Invalid feedback payload.';
  }

  if (typeof envelope.payload.message !== 'string' || envelope.payload.message.trim() === '') {
    return 'Message is required.';
  }

  if (typeof envelope.verification?.honeypot === 'string' && envelope.verification.honeypot.trim() !== '') {
    return 'Spam rejected.';
  }

  if (typeof envelope.verification?.turnstileToken !== 'string' || envelope.verification.turnstileToken.trim() === '') {
    return 'Turnstile token is required.';
  }

  return null;
}

export async function verifyTurnstile({ secretKey, token, remoteIp, fetchImpl = fetch }) {
  if (!secretKey) {
    throw new Error('TURNSTILE_SECRET_KEY is missing.');
  }

  const body = new URLSearchParams({
    secret: secretKey,
    response: token,
  });

  if (remoteIp) {
    body.set('remoteip', remoteIp);
  }

  const response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Turnstile siteverify failed with status ${response.status}.`);
  }

  return await response.json();
}

export async function forwardToAppsScript({ appsScriptUrl, appsScriptSecret, payload, fetchImpl = fetch }) {
  if (!appsScriptUrl) {
    throw new Error('APPS_SCRIPT_URL is missing.');
  }

  if (!appsScriptSecret) {
    throw new Error('APPS_SCRIPT_SECRET is missing.');
  }

  const url = new URL(appsScriptUrl);
  url.searchParams.set('secret', appsScriptSecret);

  return await fetchImpl(url.toString(), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function buildCorsHeaders(request, allowedOrigins) {
  const requestOrigin = request.headers.get('Origin') ?? '';
  const allowOrigin = resolveAllowedOrigin(requestOrigin, allowedOrigins);

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

export function resolveAllowedOrigin(requestOrigin, allowedOrigins) {
  if (allowedOrigins.length === 0) {
    return requestOrigin || '*';
  }

  return allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
}

export function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) {
    return allowedOrigins.length === 0;
  }

  return allowedOrigins.length === 0 || allowedOrigins.includes(origin);
}

export function getRemoteIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    ''
  );
}

export class InMemoryRateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  async check({ key, max, windowSec, now }) {
    const threshold = now - windowSec * 1000;
    const current = (this.buckets.get(key) ?? []).filter((timestamp) => timestamp > threshold);

    if (current.length >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((current[0] + windowSec * 1000 - now) / 1000));
      this.buckets.set(key, current);
      return { allowed: false, retryAfterSec };
    }

    current.push(now);
    this.buckets.set(key, current);
    return { allowed: true, retryAfterSec: 0 };
  }
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function safeParseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}
