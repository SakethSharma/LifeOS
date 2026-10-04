import type { AiContentBlock, AiErrorCode, AiModelInfo, AiProviderId } from '../../../src/app/core/ai/ai-contract';
import { isValidModelId } from '../../../src/app/core/ai/ai-contract';

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

  /** Models this key can use for text chat, from the provider's own model listing (free). */
  listModels(apiKey: string, call: ProviderCall): Promise<AiModelInfo[]>;

  complete(apiKey: string, input: CompletionInput, call: ProviderCall): Promise<string>;
}

/** Keeps listings to ids the backend would accept back as `model`, sorted, without duplicates. */
export function cleanModelList(models: AiModelInfo[], max = 100): AiModelInfo[] {
  const seen = new Set<string>();
  return models
    .filter((m) => isValidModelId(m.id) && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, max);
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
 * The parts of a provider error body that classification may look at. Used
 * only to pick an error code — never returned to the app or logged.
 */
export interface ProviderErrorInfo {
  status: number;
  /** Lower-cased error type / status / code / reason strings from the body. */
  markers: string[];
  /** Lower-cased message text. */
  message: string;
}

export type ErrorClassifier = (error: ProviderErrorInfo) => AiErrorCode;

/** Pulls error.type / error.code / error.status / details[].reason / message out of any provider's JSON. */
export function parseProviderError(status: number, bodyText: string): ProviderErrorInfo {
  let markers: string[] = [];
  let message = '';

  try {
    const body = JSON.parse(bodyText) as { error?: Record<string, unknown> };
    const error = body?.error;

    if (error && typeof error === 'object') {
      const details = Array.isArray(error['details']) ? (error['details'] as Record<string, unknown>[]) : [];
      markers = [error['type'], error['code'], error['status'], ...details.map((d) => d?.['reason'])]
        .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
        .map((v) => String(v).toLowerCase());
      message = typeof error['message'] === 'string' ? error['message'].toLowerCase() : '';
    }
  } catch {
    // Not JSON (gateway page etc.) — classify by status alone.
  }

  return { status, markers, message };
}

/** Status-based classification shared by all providers; provider classifiers handle their specifics first. */
export function classifyCommon({ status }: ProviderErrorInfo): AiErrorCode {
  if (status === 401) return 'INVALID_KEY';
  if (status === 402) return 'QUOTA_EXCEEDED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status === 404) return 'UNSUPPORTED_CAPABILITY';
  if (status === 408 || status === 504) return 'TIMEOUT';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400 || status === 413 || status === 422) return 'INVALID_REQUEST';
  if (status >= 500) return 'PROVIDER_ERROR';
  return 'UNKNOWN_ERROR';
}

/** fetch() wrapper that turns transport failures and error responses into ProviderFailure codes. */
export async function providerFetch(
  call: ProviderCall,
  url: string,
  init: RequestInit,
  classify: ErrorClassifier = classifyCommon,
): Promise<Response> {
  let response: Response;

  try {
    response = await call.fetch(url, { ...init, signal: call.signal });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    throw new ProviderFailure(name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_ERROR');
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new ProviderFailure(classify(parseProviderError(response.status, bodyText)), response.status);
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
