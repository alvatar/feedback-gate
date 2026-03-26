import { handleFeedbackRequest } from './feedback-core.mjs';

export default {
  async fetch(request, env) {
    return await handleFeedbackRequest(request, env, {
      rateLimiter: createDurableRateLimiter(env.FEEDBACK_RATE_LIMITER),
    });
  },
};

export class FeedbackRateLimiter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const max = Number.parseInt(url.searchParams.get('max') || '5', 10);
    const windowSec = Number.parseInt(url.searchParams.get('windowSec') || '300', 10);
    const now = Date.now();
    const threshold = now - windowSec * 1000;

    const existing = ((await this.state.storage.get('hits')) ?? []).filter((timestamp) => timestamp > threshold);
    if (existing.length >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((existing[0] + windowSec * 1000 - now) / 1000));
      await this.state.storage.put('hits', existing);
      return json({ allowed: false, retryAfterSec });
    }

    existing.push(now);
    await this.state.storage.put('hits', existing);
    return json({ allowed: true, retryAfterSec: 0 });
  }
}

function createDurableRateLimiter(namespace) {
  return {
    async check({ key, max, windowSec }) {
      const objectId = namespace.idFromName(await sha256(key));
      const stub = namespace.get(objectId);
      const response = await stub.fetch(`https://rate-limit.local/check?max=${max}&windowSec=${windowSec}`, {
        method: 'POST',
      });
      return await response.json();
    },
  };
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
