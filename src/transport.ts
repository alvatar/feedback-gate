export interface SubmitFeedbackInput {
  endpoint: string;
  body: unknown;
  headers: Record<string, string>;
  credentials?: RequestCredentials;
  query?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<Response> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error('fetch is not available in the current environment.');
  }

  const response = await fetchImpl(buildEndpointUrl(input.endpoint, input.query), {
    method: 'POST',
    headers: input.headers,
    body: JSON.stringify(input.body),
    credentials: input.credentials,
  });

  if (!response.ok) {
    const body = await safeReadResponseText(response);
    throw new Error(body || `Feedback submission failed with status ${response.status}.`);
  }

  return response;
}

export function buildEndpointUrl(endpoint: string, query?: Record<string, string>): string {
  if (!query || Object.keys(query).length === 0) {
    return endpoint;
  }

  const base =
    typeof globalThis.location?.href === 'string' ? globalThis.location.href : 'https://feedback-gate.local';
  const url = new URL(endpoint, base);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(endpoint)) {
    return url.toString();
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}
