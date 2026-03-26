import { type FeedbackTurnstileConfig } from './types.js';

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  appearance?: 'always' | 'execute' | 'interaction-only';
  execution?: 'render' | 'execute';
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

const DEFAULT_TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let turnstileLoadPromise: Promise<TurnstileApi> | null = null;

export class TurnstileController {
  private widgetId: string | null = null;
  private turnstileApi: TurnstileApi | null = null;
  private pendingTokenRequest:
    | {
        resolve: (token: string) => void;
        reject: (error: Error) => void;
        timeoutId: number;
      }
    | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly config: FeedbackTurnstileConfig,
  ) {}

  async getToken(): Promise<string> {
    const api = await this.ensureWidget();

    if (!this.widgetId) {
      throw new Error('Turnstile widget is not ready.');
    }

    if (this.pendingTokenRequest) {
      throw new Error('Turnstile verification is already in progress.');
    }

    return await new Promise<string>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingTokenRequest = null;
        reject(new Error('Turnstile verification timed out.'));
      }, this.config.tokenTimeoutMs ?? 15000);

      this.pendingTokenRequest = {
        resolve,
        reject,
        timeoutId,
      };

      api.reset(this.widgetId!);
      api.execute(this.widgetId!);
    });
  }

  async ensureWidget(): Promise<TurnstileApi> {
    if (this.turnstileApi && this.widgetId) {
      return this.turnstileApi;
    }

    const api = await loadTurnstileScript(this.config.scriptUrl);
    this.turnstileApi = api;

    if (!this.widgetId) {
      this.widgetId = api.render(this.container, {
        sitekey: this.config.siteKey,
        action: this.config.action,
        appearance: 'execute',
        execution: 'execute',
        callback: (token) => {
          if (!this.pendingTokenRequest) {
            return;
          }
          window.clearTimeout(this.pendingTokenRequest.timeoutId);
          this.pendingTokenRequest.resolve(token);
          this.pendingTokenRequest = null;
        },
        'expired-callback': () => {
          if (!this.pendingTokenRequest) {
            return;
          }
          window.clearTimeout(this.pendingTokenRequest.timeoutId);
          this.pendingTokenRequest.reject(new Error('Turnstile token expired.'));
          this.pendingTokenRequest = null;
        },
        'error-callback': () => {
          if (!this.pendingTokenRequest) {
            return;
          }
          window.clearTimeout(this.pendingTokenRequest.timeoutId);
          this.pendingTokenRequest.reject(new Error('Turnstile verification failed.'));
          this.pendingTokenRequest = null;
        },
      });
    }

    return api;
  }

  destroy(): void {
    if (this.turnstileApi && this.widgetId) {
      this.turnstileApi.remove(this.widgetId);
    }

    if (this.pendingTokenRequest) {
      window.clearTimeout(this.pendingTokenRequest.timeoutId);
      this.pendingTokenRequest.reject(new Error('Turnstile verification was cancelled.'));
      this.pendingTokenRequest = null;
    }

    this.widgetId = null;
    this.turnstileApi = null;
  }
}

async function loadTurnstileScript(scriptUrl = DEFAULT_TURNSTILE_SCRIPT_URL): Promise<TurnstileApi> {
  if (window.turnstile) {
    return window.turnstile;
  }

  if (!turnstileLoadPromise) {
    turnstileLoadPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-feedback-gate-turnstile="true"]');
      if (existing) {
        existing.addEventListener('load', () => {
          if (window.turnstile) {
            resolve(window.turnstile);
          } else {
            reject(new Error('Turnstile script loaded without exposing the API.'));
          }
        });
        existing.addEventListener('error', () => {
          turnstileLoadPromise = null;
          reject(new Error('Failed to load Turnstile script.'));
        });
        return;
      }

      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.defer = true;
      script.dataset.feedbackGateTurnstile = 'true';
      script.onload = () => {
        if (window.turnstile) {
          resolve(window.turnstile);
        } else {
          turnstileLoadPromise = null;
          reject(new Error('Turnstile script loaded without exposing the API.'));
        }
      };
      script.onerror = () => {
        turnstileLoadPromise = null;
        reject(new Error('Failed to load Turnstile script.'));
      };
      document.head.appendChild(script);
    });
  }

  return await turnstileLoadPromise;
}
