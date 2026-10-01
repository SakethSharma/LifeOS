/**
 * Request handlers for the LifeOS AI backend. Pure functions of
 * (Request, deps) → Response so they run unchanged in Netlify Functions and in
 * plain Node tests.
 *
 * Secret-handling rules enforced here:
 *  - the raw API key is accepted only by /connect and is never returned;
 *  - every other route takes the sealed credential from a header, never a body;
 *  - logs carry only route, provider, error code, HTTP status and duration —
 *    never headers, bodies, prompts, context, or keys;
 *  - error responses carry only a code, never provider text.
 */
import type {
  AiChatTurn,
  AiContentBlock,
  AiErrorCode,
  AiExtractTask,
  AiFinancialContext,
  AiProviderId,
} from '../../src/app/core/ai/ai-contract';
import { AI_CREDENTIAL_HEADER, AI_LIMITS, isAiProviderId, maskApiKey } from '../../src/app/core/ai/ai-contract';
import { isUsableSecret, openCredential, sealCredential } from './credential-seal';
import { CHAT_MAX_TOKENS, EXTRACT_TASKS, buildChatSystemPrompt } from './prompts';
import type { CompletionMessage } from './providers/provider';
import { ProviderFailure } from './providers/provider';
import { getProvider } from './providers/registry';

export interface AiBackendEnv {
  credentialSecret: string | undefined;
  timeoutMs: number;
  models: Record<AiProviderId, string>;
  allowedOrigins: string[];
}

export type SafeLogFields = Record<string, string | number | undefined>;

export interface AiBackendDeps {
  env: AiBackendEnv;
  fetch: typeof fetch;
  log: (event: string, fields: SafeLogFields) => void;
}

const DEFAULT_ALLOWED_ORIGINS = ['https://localhost', 'capacitor://localhost', 'http://localhost'];
const MAX_BODY_BYTES = 6_000_000;
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function readBackendEnv(source: Record<string, string | undefined>): AiBackendEnv {
  const timeout = Number(source['AI_PROVIDER_TIMEOUT_MS']);
  const extraOrigins = (source['AI_ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return {
    credentialSecret: source['AI_CREDENTIAL_SECRET'],
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? timeout : 9000,
    models: {
      openai: source['AI_OPENAI_MODEL']?.trim() || 'gpt-4.1-mini',
      anthropic: source['AI_ANTHROPIC_MODEL']?.trim() || 'claude-haiku-4-5-20251001',
    },
    allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS, ...extraOrigins],
  };
}

/** Logs a single line of non-sensitive fields. The only logger the backend uses. */
export function safeConsoleLog(event: string, fields: SafeLogFields): void {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`);
  console.log(`[lifeos-ai] ${event} ${parts.join(' ')}`.trim());
}

type RouteResult = { status: number; body: Record<string, unknown> };

class RequestFailure extends Error {
  constructor(
    public readonly code: AiErrorCode,
    public readonly status: number,
  ) {
    super(code);
  }
}

// ---- Routes -----------------------------------------------------------------

export function handleConnect(request: Request, deps: AiBackendDeps): Promise<Response> {
  return route('connect', request, deps, async (body) => {
    const provider = requireProvider(body);
    const apiKey = typeof body['apiKey'] === 'string' ? body['apiKey'].trim() : '';

    if (!apiKey) {
      throw new RequestFailure('NOT_CONFIGURED', 400);
    }

    if (apiKey.length > AI_LIMITS.maxApiKeyChars || /\s/.test(apiKey)) {
      throw new RequestFailure('INVALID_KEY', 400);
    }

    const secret = requireSecret(deps);

    await withTimeout(deps, provider, (call) => getProvider(provider).testConnection(apiKey, call));

    const credential = await sealCredential({ provider, apiKey }, secret);

    return { status: 200, body: { success: true, provider, credential, keyHint: maskApiKey(apiKey) } };
  });
}

export function handleTest(request: Request, deps: AiBackendDeps): Promise<Response> {
  return route('test', request, deps, async (body) => {
    const { provider, apiKey } = await requireCredential(request, body, deps);

    await withTimeout(deps, provider, (call) => getProvider(provider).testConnection(apiKey, call));

    return { status: 200, body: { success: true, provider } };
  });
}

export function handleChat(request: Request, deps: AiBackendDeps): Promise<Response> {
  return route('chat', request, deps, async (body) => {
    const message = typeof body['message'] === 'string' ? body['message'].trim() : '';

    if (!message || message.length > AI_LIMITS.maxMessageChars) {
      throw new RequestFailure('INVALID_REQUEST', 400);
    }

    const history = parseHistory(body['history']);
    const context = parseContext(body['context']);
    const { provider, apiKey } = await requireCredential(request, body, deps);

    const reply = await withTimeout(deps, provider, (call) =>
      getProvider(provider).complete(
        apiKey,
        {
          system: buildChatSystemPrompt(context),
          messages: normalizeTurns([...history, { role: 'user', content: message }]),
          maxTokens: CHAT_MAX_TOKENS,
        },
        call,
      ),
    );

    return { status: 200, body: { success: true, provider, message: reply } };
  });
}

export function handleExtract(request: Request, deps: AiBackendDeps): Promise<Response> {
  return route('extract', request, deps, async (body) => {
    const task = body['task'] as AiExtractTask;
    const taskConfig = Object.prototype.hasOwnProperty.call(EXTRACT_TASKS, task) ? EXTRACT_TASKS[task] : null;

    if (!taskConfig) {
      throw new RequestFailure('INVALID_REQUEST', 400);
    }

    const blocks = parseBlocks(body['blocks']);
    const { provider, apiKey } = await requireCredential(request, body, deps);

    const reply = await withTimeout(deps, provider, (call) =>
      getProvider(provider).complete(
        apiKey,
        {
          system: taskConfig.system,
          messages: [{ role: 'user', content: [...blocks, { type: 'text', text: taskConfig.instructions }] }],
          maxTokens: taskConfig.maxTokens,
        },
        call,
      ),
    );

    return { status: 200, body: { success: true, provider, message: reply } };
  });
}

// ---- Plumbing ---------------------------------------------------------------

async function route(
  name: string,
  request: Request,
  deps: AiBackendDeps,
  run: (body: Record<string, unknown>) => Promise<RouteResult>,
): Promise<Response> {
  const cors = corsHeaders(request, deps.env.allowedOrigins);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const started = Date.now();
  let result: RouteResult;
  let provider: string | undefined;

  try {
    if (request.method !== 'POST') {
      throw new RequestFailure('INVALID_REQUEST', 405);
    }

    const body = await readBody(request);
    provider = isAiProviderId(body['provider']) ? body['provider'] : undefined;
    result = await run(body);
  } catch (err) {
    result = toErrorResult(err);
  }

  deps.log(`route=${name}`, {
    provider,
    status: result.status,
    errorCode: result.body['success'] === false ? String(result.body['errorCode']) : undefined,
    ms: Date.now() - started,
  });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function toErrorResult(err: unknown): RouteResult {
  if (err instanceof RequestFailure) {
    return { status: err.status, body: { success: false, errorCode: err.code } };
  }

  if (err instanceof ProviderFailure) {
    const status = err.code === 'INVALID_KEY' ? 401 : err.code === 'TIMEOUT' ? 504 : 502;
    return { status, body: { success: false, errorCode: err.code } };
  }

  return { status: 500, body: { success: false, errorCode: 'SERVER_ERROR' } };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);

  if (declaredLength > MAX_BODY_BYTES) {
    throw new RequestFailure('INVALID_REQUEST', 413);
  }

  const text = await request.text();

  if (text.length > MAX_BODY_BYTES) {
    throw new RequestFailure('INVALID_REQUEST', 413);
  }

  try {
    const parsed: unknown = JSON.parse(text);

    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }

  throw new RequestFailure('INVALID_REQUEST', 400);
}

function requireProvider(body: Record<string, unknown>): AiProviderId {
  if (!isAiProviderId(body['provider'])) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }

  return body['provider'];
}

function requireSecret(deps: AiBackendDeps): string {
  if (!isUsableSecret(deps.env.credentialSecret)) {
    deps.log('config', { problem: 'AI_CREDENTIAL_SECRET missing or shorter than 32 characters' });
    throw new RequestFailure('SERVER_ERROR', 500);
  }

  return deps.env.credentialSecret;
}

async function requireCredential(
  request: Request,
  body: Record<string, unknown>,
  deps: AiBackendDeps,
): Promise<{ provider: AiProviderId; apiKey: string }> {
  const provider = requireProvider(body);
  const token = request.headers.get(AI_CREDENTIAL_HEADER)?.trim();

  if (!token) {
    throw new RequestFailure('NOT_CONFIGURED', 401);
  }

  const secret = requireSecret(deps);
  const opened = await openCredential(token, secret);

  // A token that no longer opens (tampered, or the secret was rotated) or that
  // was sealed for another provider must be re-entered — same as a bad key.
  if (!opened || opened.provider !== provider) {
    throw new RequestFailure('INVALID_KEY', 401);
  }

  return opened;
}

async function withTimeout<T>(
  deps: AiBackendDeps,
  provider: AiProviderId,
  run: (call: { fetch: typeof fetch; signal: AbortSignal; model: string }) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Provider request timed out', 'TimeoutError')),
    deps.env.timeoutMs,
  );

  try {
    return await run({ fetch: deps.fetch, signal: controller.signal, model: deps.env.models[provider] });
  } finally {
    clearTimeout(timer);
  }
}

function parseHistory(value: unknown): AiChatTurn[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }

  return value.slice(-AI_LIMITS.maxHistoryTurns).map((entry) => {
    const turn = entry as Partial<AiChatTurn> | null;
    const content = typeof turn?.content === 'string' ? turn.content.trim() : '';

    if (
      (turn?.role !== 'user' && turn?.role !== 'assistant') ||
      !content ||
      content.length > AI_LIMITS.maxHistoryTurnChars
    ) {
      throw new RequestFailure('INVALID_REQUEST', 400);
    }

    return { role: turn.role, content };
  });
}

function parseContext(value: unknown): AiFinancialContext | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }

  if (JSON.stringify(value).length > AI_LIMITS.maxContextChars) {
    throw new RequestFailure('INVALID_REQUEST', 413);
  }

  return value as AiFinancialContext;
}

function parseBlocks(value: unknown): AiContentBlock[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) {
    throw new RequestFailure('INVALID_REQUEST', 400);
  }

  let base64Chars = 0;

  const blocks = value.map((entry): AiContentBlock => {
    const block = entry as Record<string, unknown> | null;

    if (block?.['type'] === 'text' && typeof block['text'] === 'string' && block['text'].trim()) {
      if (block['text'].length > AI_LIMITS.maxExtractTextChars) {
        throw new RequestFailure('INVALID_REQUEST', 413);
      }
      return { type: 'text', text: block['text'] };
    }

    const mediaType = typeof block?.['mediaType'] === 'string' ? block['mediaType'] : '';
    const data = typeof block?.['base64Data'] === 'string' ? block['base64Data'] : '';

    if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) {
      throw new RequestFailure('INVALID_REQUEST', 400);
    }

    base64Chars += data.length;

    if (block?.['type'] === 'image' && SUPPORTED_IMAGE_TYPES.includes(mediaType)) {
      return { type: 'image', mediaType, base64Data: data };
    }

    if (block?.['type'] === 'document' && mediaType === 'application/pdf') {
      return { type: 'document', mediaType, base64Data: data };
    }

    throw new RequestFailure('INVALID_REQUEST', 400);
  });

  if (base64Chars > AI_LIMITS.maxExtractBase64Chars) {
    throw new RequestFailure('INVALID_REQUEST', 413);
  }

  return blocks;
}

/** Providers expect the first turn to be the user's and roles to alternate. */
export function normalizeTurns(turns: AiChatTurn[]): CompletionMessage[] {
  const result: CompletionMessage[] = [];

  for (const turn of turns) {
    if (result.length === 0 && turn.role !== 'user') {
      continue;
    }

    const last = result[result.length - 1];

    if (last && last.role === turn.role && typeof last.content === 'string') {
      last.content = `${last.content}\n\n${turn.content}`;
    } else {
      result.push({ role: turn.role, content: turn.content });
    }
  }

  return result;
}

function corsHeaders(request: Request, allowedOrigins: string[]): Record<string, string> {
  const origin = request.headers.get('origin');

  if (!origin || !allowedOrigins.includes(origin)) {
    return {};
  }

  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': `content-type, ${AI_CREDENTIAL_HEADER}`,
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}
