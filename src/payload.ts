import {
  type FeedbackContextConfig,
  type FeedbackSubmissionPayload,
  type PreparedSubmission,
} from './types.js';

export interface CreatePayloadInput {
  message: string;
  fields: Record<string, unknown>;
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

  const payload = await createSubmissionPayload({
    message,
    fields: input.fields,
    context: input.context,
    location: input.location,
    userAgent: input.userAgent,
  });

  return {
    payload,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...input.requestHeaders,
    },
  };
}

interface CreateSubmissionPayloadArgs {
  message: string;
  fields: Record<string, unknown>;
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
    meta: {
      userAgent: navigatorUserAgent,
      ...(args.context?.meta ?? {}),
      ...extraMeta,
    },
  };
}
