import {
  type FeedbackAuthConfig,
  type FeedbackContextConfig,
  type FeedbackSubmissionPayload,
  type FeedbackUser,
  type PreparedSubmission,
} from './types.js';

export interface CreatePayloadInput {
  message: string;
  fields: Record<string, unknown>;
  user?: FeedbackUser | null;
  auth?: FeedbackAuthConfig;
  context?: FeedbackContextConfig;
  requestHeaders?: Record<string, string>;
  location?: Pick<Location, 'hostname' | 'pathname' | 'search' | 'hash'>;
  userAgent?: string;
}

export class FeedbackGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedbackGateError';
  }
}

export async function prepareSubmission(input: CreatePayloadInput): Promise<PreparedSubmission> {
  const message = input.message.trim();
  if (message.length === 0) {
    throw new FeedbackGateError('Message is required.');
  }

  const user = input.user !== undefined ? input.user : await resolveUser(input.auth);
  if (input.auth?.required && !user) {
    throw new FeedbackGateError('Authentication is required before submitting feedback.');
  }

  const payload = await createSubmissionPayload({
    message,
    fields: input.fields,
    user,
    context: input.context,
    location: input.location,
    userAgent: input.userAgent,
  });

  const authHeaders = (await input.auth?.getHeaders?.()) ?? {};

  return {
    payload,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...input.requestHeaders,
      ...authHeaders,
    },
  };
}

interface CreateSubmissionPayloadArgs {
  message: string;
  fields: Record<string, unknown>;
  user: FeedbackUser | null;
  context?: FeedbackContextConfig;
  location?: Pick<Location, 'hostname' | 'pathname' | 'search' | 'hash'>;
  userAgent?: string;
}

export async function createSubmissionPayload(
  args: CreateSubmissionPayloadArgs,
): Promise<FeedbackSubmissionPayload> {
  const location = args.location ?? globalThis.location;
  const navigatorUserAgent = args.userAgent ?? globalThis.navigator?.userAgent ?? '';
  const extraMeta = (await args.context?.getMeta?.()) ?? {};

  return {
    timestamp: new Date().toISOString(),
    site: args.context?.site ?? location?.hostname ?? '',
    page:
      args.context?.page ??
      `${location?.pathname ?? ''}${location?.search ?? ''}${location?.hash ?? ''}`,
    message: args.message,
    fields: args.fields,
    user: args.user,
    meta: {
      userAgent: navigatorUserAgent,
      ...(args.context?.meta ?? {}),
      ...extraMeta,
    },
  };
}

async function resolveUser(auth?: FeedbackAuthConfig): Promise<FeedbackUser | null> {
  if (!auth?.getUser) {
    return null;
  }

  return (await auth.getUser()) ?? null;
}
