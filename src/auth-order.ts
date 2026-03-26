import { type FeedbackAuthConfig, type FeedbackAuthProvider } from './types.js';

export interface AuthProviderOrderingEnvironment {
  languages?: string[];
  language?: string;
  timeZone?: string;
  platform?: string;
  userAgent?: string;
}

export function getOrderedProviders(
  auth?: Pick<FeedbackAuthConfig, 'providers' | 'providerOrder'>,
  environment?: AuthProviderOrderingEnvironment,
): FeedbackAuthProvider[] {
  const providers = auth?.providers ?? [];
  if (providers.length <= 1) {
    return providers;
  }

  const providerOrder = auth?.providerOrder;
  if (Array.isArray(providerOrder) && providerOrder.length > 0) {
    return sortProvidersByPriority(providers, providerOrder);
  }

  return sortProvidersByPriority(providers, detectAutoProviderPriority(environment));
}

export function detectAutoProviderPriority(environment: AuthProviderOrderingEnvironment = {}): string[] {
  const languages = environment.languages ?? globalThis.navigator?.languages ?? [];
  const language = environment.language ?? globalThis.navigator?.language ?? '';
  const localeHints = [language, ...languages].map((value) => value.toLowerCase());
  const timeZone = (environment.timeZone ?? safeResolvedTimeZone()).toLowerCase();
  const platform = (environment.platform ?? globalThis.navigator?.platform ?? '').toLowerCase();
  const userAgent = (environment.userAgent ?? globalThis.navigator?.userAgent ?? '').toLowerCase();

  const isChinaContext =
    localeHints.some((value) => value.startsWith('zh-cn') || value.includes('hans')) ||
    timeZone.includes('shanghai') ||
    timeZone.includes('china');

  if (isChinaContext) {
    return ['wechat', 'email', 'apple', 'google', 'facebook'];
  }

  const isAppleContext =
    platform.includes('mac') ||
    platform.includes('iphone') ||
    platform.includes('ipad') ||
    userAgent.includes('iphone') ||
    userAgent.includes('ipad') ||
    userAgent.includes('mac os');

  if (isAppleContext) {
    return ['apple', 'google', 'facebook', 'wechat', 'email'];
  }

  return ['google', 'apple', 'facebook', 'wechat', 'email'];
}

export function sortProvidersByPriority(
  providers: FeedbackAuthProvider[],
  priority: string[],
): FeedbackAuthProvider[] {
  const order = new Map(priority.map((id, index) => [id, index]));
  return [...providers].sort((left, right) => {
    const leftPriority = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.label.localeCompare(right.label);
  });
}

function safeResolvedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}
