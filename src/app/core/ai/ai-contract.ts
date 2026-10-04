/**
 * Wire contract between the LifeOS app and the LifeOS AI backend
 * (netlify/functions/ai-*.mts). Framework-free on purpose: the backend imports
 * this exact file, so the two sides can never drift apart.
 *
 * Credentials never travel inside these bodies. The sealed credential goes in
 * the AI_CREDENTIAL_HEADER request header only, and the raw API key is sent
 * exactly once, to /connect.
 */

/** Cloud providers reached through the LifeOS AI backend with the user's own key. */
export type AiProviderId = 'openai' | 'gemini' | 'anthropic';

/** Display order everywhere in the app. */
export const AI_PROVIDER_IDS: readonly AiProviderId[] = ['openai', 'gemini', 'anthropic'];

/**
 * Ollama runs on the user's own computer, so the app talks to it directly and
 * the LifeOS backend never sees it. App-side only: `isAiProviderId` (and so
 * every backend route) rejects 'ollama'.
 */
export const OLLAMA_PROVIDER = 'ollama';

/** Anything the user can pick to answer AI requests. */
export type AiProviderChoice = AiProviderId | typeof OLLAMA_PROVIDER;

export const AI_PROVIDER_CHOICES: readonly AiProviderChoice[] = [...AI_PROVIDER_IDS, OLLAMA_PROVIDER];

export type AiAttachmentKind = 'image' | 'pdf';

/**
 * What each provider can accept, in one place. The backend enforces it before
 * calling a provider, and the app uses it to explain limits up front.
 */
export const AI_PROVIDER_CAPABILITIES: Record<AiProviderId, { attachments: readonly AiAttachmentKind[] }> = {
  openai: { attachments: ['image', 'pdf'] },
  gemini: { attachments: ['image', 'pdf'] },
  anthropic: { attachments: ['image', 'pdf'] },
};

/** Ollama vision models read images; Ollama has no PDF input. */
export const OLLAMA_CAPABILITIES: { attachments: readonly AiAttachmentKind[] } = { attachments: ['image'] };

export const AI_CREDENTIAL_HEADER = 'x-lifeos-ai-credential';

export type AiErrorCode =
  | 'NOT_CONFIGURED'
  | 'OFFLINE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INVALID_KEY'
  /** Key is valid but not allowed this request (model, region, project permissions). */
  | 'PERMISSION_DENIED'
  /** Provider says credits are used up / payment is required. */
  | 'QUOTA_EXCEEDED'
  /** Provider says billing isn't set up for this account or project. */
  | 'BILLING_NOT_CONFIGURED'
  /** A spend or usage cap was hit, or the provider's message is ambiguous between a cap and billing. */
  | 'USAGE_LIMIT'
  /** Per-minute request/token rate limit — not a billing problem. */
  | 'RATE_LIMITED'
  /** The selected provider or model can't do this (model not found, unsupported file type). */
  | 'UNSUPPORTED_CAPABILITY'
  | 'PROVIDER_ERROR'
  | 'EMPTY_RESPONSE'
  | 'INVALID_REQUEST'
  | 'SERVER_ERROR'
  | 'BACKEND_UNAVAILABLE'
  /** App-side only: the server answering isn't the LifeOS AI backend (e.g. a plain file server). */
  | 'BACKEND_NOT_RUNNING'
  /** App-side only: the local AI server (Ollama) didn't answer — not running, wrong URL, or blocked by the browser (CORS). */
  | 'LOCAL_AI_UNREACHABLE'
  /** The selected model isn't installed / available for this provider. */
  | 'MODEL_UNAVAILABLE'
  /** App-side only: the user stopped the request. Never shown as an error. */
  | 'CANCELLED'
  | 'UNKNOWN_ERROR';

export const AI_ERROR_CODES: readonly AiErrorCode[] = [
  'NOT_CONFIGURED',
  'OFFLINE',
  'NETWORK_ERROR',
  'TIMEOUT',
  'INVALID_KEY',
  'PERMISSION_DENIED',
  'QUOTA_EXCEEDED',
  'BILLING_NOT_CONFIGURED',
  'USAGE_LIMIT',
  'RATE_LIMITED',
  'UNSUPPORTED_CAPABILITY',
  'PROVIDER_ERROR',
  'EMPTY_RESPONSE',
  'INVALID_REQUEST',
  'SERVER_ERROR',
  'BACKEND_UNAVAILABLE',
  'BACKEND_NOT_RUNNING',
  'LOCAL_AI_UNREACHABLE',
  'MODEL_UNAVAILABLE',
  'CANCELLED',
  'UNKNOWN_ERROR',
];

export type AiChatRole = 'user' | 'assistant';

export interface AiChatTurn {
  role: AiChatRole;
  content: string;
}

/**
 * LifeOS facts that were computed deterministically on the device. Kept as an
 * open record so new context sources (and, later, tool results) can be added
 * without a contract change; the backend only size-checks it.
 */
export type AiFinancialContext = Record<string, unknown>;

// ---- Requests ---------------------------------------------------------------

export interface AiConnectRequest {
  provider: AiProviderId;
  apiKey: string;
}

/** Body of /test and /models — the credential itself is in the header. */
export interface AiTestRequest {
  provider: AiProviderId;
}

/** A model the user can choose. `id` is what's sent back as `model`. */
export interface AiModelInfo {
  id: string;
  label: string;
}

export interface AiChatRequest {
  provider: AiProviderId;
  /** Earlier turns of this conversation, oldest first. */
  history: AiChatTurn[];
  message: string;
  context: AiFinancialContext | null;
  /** Files attached to this message only (not resent with later turns). */
  attachments?: AiContentBlock[];
  /** Model chosen by the user; omitted = the backend's default for this provider. */
  model?: string;
}

export type AiExtractTask = 'salary_document';

export type AiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; base64Data: string }
  | { type: 'document'; mediaType: string; base64Data: string };

export interface AiExtractRequest {
  provider: AiProviderId;
  task: AiExtractTask;
  blocks: AiContentBlock[];
  model?: string;
}

// ---- Responses --------------------------------------------------------------

export interface AiErrorResponse {
  success: false;
  errorCode: AiErrorCode;
}

export interface AiConnectSuccess {
  success: true;
  provider: AiProviderId;
  /** Opaque, server-encrypted credential. Only the LifeOS backend can open it. */
  credential: string;
  /** Masked hint for display, e.g. "sk-••••••••wxyz". */
  keyHint: string;
  /**
   * True when the provider accepted the key. False when the check couldn't
   * finish (timeout, provider down, rate limit…) — the key is saved but unverified.
   */
  verified: boolean;
  /** Why verification couldn't finish, when `verified` is false. */
  verifyErrorCode?: AiErrorCode;
}

export interface AiTestSuccess {
  success: true;
  provider: AiProviderId;
}

export interface AiMessageSuccess {
  success: true;
  provider: AiProviderId;
  message: string;
}

export interface AiModelsSuccess {
  success: true;
  provider: AiProviderId;
  models: AiModelInfo[];
  /** Model the backend uses when the app doesn't choose one. */
  defaultModel: string;
}

export type AiConnectResponse = AiConnectSuccess | AiErrorResponse;
export type AiTestResponse = AiTestSuccess | AiErrorResponse;
export type AiMessageResponse = AiMessageSuccess | AiErrorResponse;

// ---- Limits (enforced by the backend, respected by the app) ----------------

export const AI_LIMITS = {
  maxMessageChars: 4000,
  maxHistoryTurns: 12,
  maxHistoryTurnChars: 6000,
  maxContextChars: 24_000,
  maxApiKeyChars: 400,
  /** Base64 characters across all blocks; keeps requests under the 6 MB function payload cap. */
  maxExtractBase64Chars: 5_500_000,
  maxExtractTextChars: 40_000,
  /** Files per chat message. */
  maxChatAttachments: 3,
} as const;

// ---- Helpers ----------------------------------------------------------------

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Billing / credit / usage-cap problems — shown with "Open Usage Credits". */
export function isBillingError(code: AiErrorCode | null | undefined): boolean {
  return code === 'QUOTA_EXCEEDED' || code === 'BILLING_NOT_CONFIGURED' || code === 'USAGE_LIMIT';
}

/** Kinds of the given attachments the provider can't accept (empty = all fine). */
export function unsupportedAttachmentKinds(
  provider: AiProviderChoice,
  blocks: readonly AiContentBlock[],
  capabilities = AI_PROVIDER_CAPABILITIES,
): AiAttachmentKind[] {
  const allowed = provider === OLLAMA_PROVIDER ? OLLAMA_CAPABILITIES.attachments : capabilities[provider].attachments;
  const kinds = blocks.flatMap((b): AiAttachmentKind[] =>
    b.type === 'image' ? ['image'] : b.type === 'document' ? ['pdf'] : [],
  );
  return [...new Set(kinds.filter((k) => !allowed.includes(k)))];
}

/**
 * Model ids the backend will forward. Letters, digits, '.', '_', '-' and ':'
 * only — so a model id can never change the provider URL it's placed in.
 */
export function isValidModelId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value);
}

export function isAiErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === 'string' && (AI_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Masks an API key for display: keeps a short known, non-secret prefix
 * ("sk-", "sk-ant-", "AIza") and the last four characters. Never returns more than 4 characters of the
 * secret part, and nothing at all for very short input.
 */
export function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  const dots = '••••••••';

  if (key.length < 12) {
    return dots;
  }

  const prefixMatch = /^(sk-ant-|sk-proj-|sk-|AIza)/.exec(key);
  const prefix = prefixMatch ? prefixMatch[1] : '';

  return `${prefix}${dots}${key.slice(-4)}`;
}
