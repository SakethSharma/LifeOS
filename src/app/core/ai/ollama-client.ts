import type { AiChatTurn, AiContentBlock, AiErrorCode, AiModelInfo } from './ai-contract';
import { AiRequestError, abortCode, requestSignal } from './ai-errors';

export const OLLAMA_DEFAULT_URL = 'http://localhost:11434';

/** Ollama can read images with vision models; it has no PDF input. */
export const OLLAMA_ATTACHMENTS = ['image'] as const;

export interface OllamaClientOptions {
  fetch: typeof fetch;
  /** Local models can be slow on CPU, so this is much longer than the cloud timeout. */
  timeoutMs?: number;
}

export interface OllamaChatInput {
  baseUrl: string;
  model: string;
  system: string;
  turns: AiChatTurn[];
  /** Files for the newest user message. Only images are accepted. */
  blocks?: AiContentBlock[];
  maxTokens: number;
  /** Ask Ollama for strict JSON output (used for document extraction). */
  json?: boolean;
  /**
   * Aborting closes the HTTP connection; Ollama stops generating when its
   * client disconnects.
   */
  cancel?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const LIST_TIMEOUT_MS = 8_000;
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Validates an Ollama server address and returns its origin, or null.
 *
 * Plain http is accepted only for this device (localhost / 127.0.0.1 / ::1):
 * anything else would send financial data unencrypted across a network.
 * Credentials, paths and queries are rejected rather than silently dropped.
 */
export function normalizeOllamaUrl(input: string): string | null {
  let url: URL;

  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  const loopback = LOOPBACK_HOSTS.includes(url.hostname) || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  const protocolOk = url.protocol === 'https:' || (url.protocol === 'http:' && loopback);

  if (!protocolOk || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    return null;
  }

  return url.origin;
}

export function isLoopbackOllamaUrl(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return LOOPBACK_HOSTS.includes(hostname) || /^127\.\d+\.\d+\.\d+$/.test(hostname);
  } catch {
    return false;
  }
}

/**
 * Talks to the user's own Ollama server (REST API: /api/tags, /api/chat).
 * Runs in the browser because the LifeOS backend can't reach the user's
 * computer. No API key is involved. Everything it throws is an AiRequestError.
 */
export class OllamaClient {
  constructor(private readonly options: OllamaClientOptions) {}

  /** Installed models (GET /api/tags). Also serves as the connection test. */
  async listModels(baseUrl: string): Promise<AiModelInfo[]> {
    const payload = await this.request<{ models?: { name?: unknown; model?: unknown }[] }>(
      baseUrl,
      '/api/tags',
      { method: 'GET' },
      LIST_TIMEOUT_MS,
    );

    const names = (payload.models ?? [])
      .map((m) => (typeof m.name === 'string' ? m.name : typeof m.model === 'string' ? m.model : ''))
      .filter((name) => name.length > 0 && name.length <= 200);

    return [...new Set(names)].sort().map((id) => ({ id, label: id }));
  }

  /** One non-streaming chat turn (POST /api/chat). */
  async chat(input: OllamaChatInput): Promise<string> {
    const blocks = input.blocks ?? [];

    if (blocks.some((b) => b.type === 'document')) {
      throw new AiRequestError('UNSUPPORTED_CAPABILITY');
    }

    const images = blocks.flatMap((b) => (b.type === 'image' ? [b.base64Data] : []));
    const extraText = blocks.flatMap((b) => (b.type === 'text' ? [b.text] : []));
    const messages: Record<string, unknown>[] = [
      { role: 'system', content: input.system },
      ...input.turns.map((t) => ({ role: t.role, content: t.content })),
    ];

    const last = messages[messages.length - 1];
    if (last && last['role'] === 'user') {
      if (extraText.length) last['content'] = [...extraText, String(last['content'])].join('\n\n');
      if (images.length) last['images'] = images;
    }

    const payload = await this.request<{ message?: { content?: unknown } }>(input.baseUrl, '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        messages,
        stream: false,
        ...(input.json ? { format: 'json' } : {}),
        options: { num_predict: input.maxTokens },
      }),
    }, undefined, input.cancel);

    const text = typeof payload.message?.content === 'string' ? payload.message.content.trim() : '';

    if (!text) {
      throw new AiRequestError('EMPTY_RESPONSE');
    }

    return text;
  }

  private async request<T>(
    baseUrl: string,
    path: string,
    init: RequestInit,
    timeoutMs?: number,
    cancel?: AbortSignal,
  ): Promise<T> {
    const origin = normalizeOllamaUrl(baseUrl);

    if (!origin) {
      throw new AiRequestError('INVALID_REQUEST');
    }

    if (cancel?.aborted) {
      throw new AiRequestError('CANCELLED');
    }

    let response: Response;

    try {
      response = await this.options.fetch(`${origin}${path}`, {
        ...init,
        // Nothing sent to or received from Ollama should be cached.
        cache: 'no-store',
        signal: requestSignal(timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS, cancel),
      });
    } catch (err) {
      // A browser reports "not running", "wrong address", CORS and mixed-content blocks identically.
      throw new AiRequestError(abortCode(err, cancel) ?? 'LOCAL_AI_UNREACHABLE');
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      throw new AiRequestError(classifyOllamaError(response.status, typeof body?.error === 'string' ? body.error : ''));
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new AiRequestError(cancel?.aborted ? 'CANCELLED' : 'EMPTY_RESPONSE');
    }
  }
}

/** Ollama answers errors as {"error": "..."}; the text is used only to pick a code, never shown. */
export function classifyOllamaError(status: number, message: string): AiErrorCode {
  const text = message.toLowerCase();

  if (status === 404 || (text.includes('model') && text.includes('not found'))) return 'MODEL_UNAVAILABLE';
  if (text.includes('image') || text.includes('vision') || text.includes('multimodal')) return 'UNSUPPORTED_CAPABILITY';
  if (status === 403) return 'LOCAL_AI_UNREACHABLE';
  if (status === 400) return 'INVALID_REQUEST';
  if (status >= 500) return 'PROVIDER_ERROR';
  return 'UNKNOWN_ERROR';
}
