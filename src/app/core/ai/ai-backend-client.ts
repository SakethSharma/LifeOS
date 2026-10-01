import type {
  AiChatRequest,
  AiConnectRequest,
  AiConnectSuccess,
  AiErrorCode,
  AiExtractRequest,
  AiMessageSuccess,
  AiProviderId,
  AiTestSuccess,
} from './ai-contract';
import { AI_CREDENTIAL_HEADER, isAiErrorCode } from './ai-contract';
import { AiRequestError } from './ai-errors';

export interface AiBackendClientOptions {
  /** '' = same origin (the deployed PWA). null = this build has no AI backend configured. */
  baseUrl: string | null;
  fetch: typeof fetch;
  isOnline: () => boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * HTTP client for the LifeOS AI backend. The only code in the app that knows
 * endpoint paths or wire formats; everything it throws is an AiRequestError
 * with a user-safe code, never a raw HTTP or provider error.
 */
export class AiBackendClient {
  constructor(private readonly options: AiBackendClientOptions) {}

  /** Sends the raw key once; gets back a sealed credential after a real provider check. */
  connect(request: AiConnectRequest): Promise<AiConnectSuccess> {
    return this.post<AiConnectSuccess>('connect', request, null);
  }

  test(provider: AiProviderId, credential: string): Promise<AiTestSuccess> {
    return this.post<AiTestSuccess>('test', { provider }, credential);
  }

  async chat(request: AiChatRequest, credential: string): Promise<string> {
    return (await this.post<AiMessageSuccess>('chat', request, credential)).message;
  }

  async extract(request: AiExtractRequest, credential: string): Promise<string> {
    return (await this.post<AiMessageSuccess>('extract', request, credential)).message;
  }

  private async post<T extends { success: true }>(
    path: string,
    body: unknown,
    credential: string | null,
  ): Promise<T> {
    const { baseUrl } = this.options;

    if (baseUrl === null) {
      throw new AiRequestError('BACKEND_UNAVAILABLE');
    }

    if (!this.options.isOnline()) {
      throw new AiRequestError('OFFLINE');
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };

    if (credential) {
      headers[AI_CREDENTIAL_HEADER] = credential;
    }

    let response: Response;

    try {
      response = await this.options.fetch(`${baseUrl}/api/ai/${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;

      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new AiRequestError('TIMEOUT');
      }

      // The connection may have dropped mid-request.
      throw new AiRequestError(this.options.isOnline() ? 'NETWORK_ERROR' : 'OFFLINE');
    }

    const payload = await response.json().catch(() => null);

    if (payload && typeof payload === 'object' && 'success' in payload) {
      if (payload.success === true && response.ok) {
        return payload as T;
      }

      if (payload.success === false) {
        const code: unknown = payload.errorCode;
        throw new AiRequestError(isAiErrorCode(code) ? code : 'UNKNOWN_ERROR');
      }
    }

    throw new AiRequestError(statusFallback(response.status));
  }
}

/** For responses that aren't from our backend at all (gateway pages, SPA fallback, 404). */
function statusFallback(status: number): AiErrorCode {
  if (status === 504 || status === 408) return 'TIMEOUT';
  if (status === 404 || (status >= 200 && status < 300)) return 'BACKEND_UNAVAILABLE';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UNKNOWN_ERROR';
}
