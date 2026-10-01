import type { AiContentBlock, AiErrorCode, AiProviderId } from '../../../src/app/core/ai/ai-contract';

/**
 * One provider adapter per AI vendor. Handlers only talk to this interface, so
 * adding a provider means adding one file and one registry entry.
 *
 * A future tool-calling loop would extend CompletionInput with tool
 * definitions and CompletionOutput with tool calls; nothing above this layer
 * depends on the output being text-only.
 */
export interface AiProviderAdapter {
  readonly id: AiProviderId;

  /** Makes a real, zero-cost authenticated call (model listing) to prove the key works. */
  testConnection(apiKey: string, call: ProviderCall): Promise<void>;

  complete(apiKey: string, input: CompletionInput, call: ProviderCall): Promise<string>;
}

export interface ProviderCall {
  fetch: typeof fetch;
  signal: AbortSignal;
  model: string;
}

export interface CompletionMessage {
  role: 'user' | 'assistant';
  content: string | AiContentBlock[];
}

export interface CompletionInput {
  system: string;
  messages: CompletionMessage[];
  maxTokens: number;
}

/** A failure already classified into the public error vocabulary. Carries no provider text. */
export class ProviderFailure extends Error {
  constructor(
    public readonly code: AiErrorCode,
    public readonly httpStatus?: number,
  ) {
    super(code);
    this.name = 'ProviderFailure';
  }
}

/**
 * Classifies a non-2xx provider response. The body is inspected only for
 * well-known billing markers and is never returned or logged.
 */
export function classifyProviderStatus(status: number, bodyText: string): AiErrorCode {
  const body = bodyText.toLowerCase();

  if (status === 401 || status === 403) return 'INVALID_KEY';
  if (body.includes('insufficient_quota') || body.includes('credit balance')) return 'QUOTA_EXCEEDED';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 408) return 'TIMEOUT';
  if (status === 404) return 'SERVER_ERROR';
  if (status === 400 || status === 413 || status === 422) return 'INVALID_REQUEST';
  if (status >= 500) return 'PROVIDER_ERROR';
  return 'UNKNOWN_ERROR';
}

/** fetch() wrapper that turns transport failures into ProviderFailure codes. */
export async function providerFetch(call: ProviderCall, url: string, init: RequestInit): Promise<Response> {
  let response: Response;

  try {
    response = await call.fetch(url, { ...init, signal: call.signal });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    throw new ProviderFailure(name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_ERROR');
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new ProviderFailure(classifyProviderStatus(response.status, bodyText), response.status);
  }

  return response;
}

export async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderFailure('EMPTY_RESPONSE', response.status);
  }
}
