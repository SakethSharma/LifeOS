/**
 * Wire contract between the LifeOS app and the LifeOS AI backend
 * (netlify/functions/ai-*.mts). Framework-free on purpose: the backend imports
 * this exact file, so the two sides can never drift apart.
 *
 * Credentials never travel inside these bodies. The sealed credential goes in
 * the AI_CREDENTIAL_HEADER request header only, and the raw API key is sent
 * exactly once, to /connect.
 */

export type AiProviderId = 'openai' | 'anthropic';

export const AI_PROVIDER_IDS: readonly AiProviderId[] = ['openai', 'anthropic'];

export const AI_CREDENTIAL_HEADER = 'x-lifeos-ai-credential';

export type AiErrorCode =
  | 'NOT_CONFIGURED'
  | 'OFFLINE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INVALID_KEY'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'EMPTY_RESPONSE'
  | 'INVALID_REQUEST'
  | 'SERVER_ERROR'
  | 'BACKEND_UNAVAILABLE'
  | 'UNKNOWN_ERROR';

export const AI_ERROR_CODES: readonly AiErrorCode[] = [
  'NOT_CONFIGURED',
  'OFFLINE',
  'NETWORK_ERROR',
  'TIMEOUT',
  'INVALID_KEY',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'EMPTY_RESPONSE',
  'INVALID_REQUEST',
  'SERVER_ERROR',
  'BACKEND_UNAVAILABLE',
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

/** Body of /test — the credential itself is in the header. */
export interface AiTestRequest {
  provider: AiProviderId;
}

export interface AiChatRequest {
  provider: AiProviderId;
  /** Earlier turns of this conversation, oldest first. */
  history: AiChatTurn[];
  message: string;
  context: AiFinancialContext | null;
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
} as const;

// ---- Helpers ----------------------------------------------------------------

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

export function isAiErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === 'string' && (AI_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Masks an API key for display: keeps a short known prefix ("sk-", "sk-ant-")
 * and the last four characters. Never returns more than 4 characters of the
 * secret part, and nothing at all for very short input.
 */
export function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  const dots = '••••••••';

  if (key.length < 12) {
    return dots;
  }

  const prefixMatch = /^(sk-ant-|sk-proj-|sk-)/.exec(key);
  const prefix = prefixMatch ? prefixMatch[1] : '';

  return `${prefix}${dots}${key.slice(-4)}`;
}
