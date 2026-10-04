import type { AiErrorCode } from './ai-contract';

/**
 * What the user can do next. Every error has one obvious primary action;
 * billing problems add more (open billing, retry, switch provider).
 */
export type AiErrorAction = 'connect' | 'retry' | 'check-key' | 'manual' | 'billing' | 'switch-provider';

export interface AiErrorActionButton {
  action: AiErrorAction;
  label: string;
}

export interface AiErrorView {
  code: AiErrorCode;
  icon: string;
  title: string;
  message: string;
  action: AiErrorAction;
  actionLabel: string;
  /** Further actions shown after the primary one. "switch-provider" is only shown when another provider is ready. */
  extraActions?: AiErrorActionButton[];
  /** Small note under the actions. */
  caption?: string;
}

type ErrorCopy = Omit<AiErrorView, 'code'>;

const RETRY = { action: 'retry', actionLabel: 'Try Again' } as const;
const SWITCH: AiErrorActionButton = { action: 'switch-provider', label: 'Switch Provider' };

/** "AI usage unavailable": open billing first, then retry or switch. */
const BILLING_ACTIONS = {
  icon: '💳',
  title: 'AI usage unavailable',
  action: 'billing',
  actionLabel: 'Open Usage Credits',
  extraActions: [{ action: 'retry', label: 'Try Again' }, SWITCH],
  caption: "Opens your provider's billing page in a new tab",
} as const;

const ERROR_COPY: Record<AiErrorCode, ErrorCopy> = {
  NOT_CONFIGURED: {
    icon: '✦',
    title: "AI isn't connected yet",
    message: 'To use AI Insights, connect an AI provider first.',
    action: 'connect',
    actionLabel: 'How to connect AI',
  },
  OFFLINE: {
    icon: '⚡',
    title: "You're offline",
    message: 'AI features require an internet connection. Please connect to the internet and try again.',
    ...RETRY,
  },
  NETWORK_ERROR: {
    icon: '⚡',
    title: "Couldn't reach LifeOS AI",
    message: 'Please check your internet connection and try again.',
    ...RETRY,
  },
  TIMEOUT: {
    icon: '⏱',
    title: 'That took too long',
    message: 'The AI request took too long. Please try again.',
    ...RETRY,
  },
  INVALID_KEY: {
    icon: '⚠',
    title: "Couldn't sign in to your AI provider",
    message: "We couldn't authenticate with your AI provider. Please check your API key.",
    action: 'check-key',
    actionLabel: 'Check API Key',
  },
  QUOTA_EXCEEDED: {
    ...BILLING_ACTIONS,
    extraActions: [...BILLING_ACTIONS.extraActions],
    message:
      "Your selected AI provider may have insufficient credits or a billing issue. You can review your provider's billing settings or switch to another connected AI provider.",
  },
  BILLING_NOT_CONFIGURED: {
    ...BILLING_ACTIONS,
    extraActions: [...BILLING_ACTIONS.extraActions],
    message:
      "Billing may not be set up for your selected AI provider. You can review your provider's billing settings or switch to another connected AI provider.",
  },
  USAGE_LIMIT: {
    ...BILLING_ACTIONS,
    extraActions: [...BILLING_ACTIONS.extraActions],
    message:
      "There may be a billing or usage-limit issue with your AI provider. You can review your provider's billing settings, try again later, or switch to another connected AI provider.",
  },
  RATE_LIMITED: {
    icon: '⏱',
    title: 'Too many requests',
    message: 'Your AI provider is limiting how fast requests can be sent. Wait a moment and try again.',
    ...RETRY,
    extraActions: [SWITCH],
  },
  PERMISSION_DENIED: {
    icon: '⚠',
    title: 'Access not allowed',
    message:
      "Your API key isn't allowed to make this request — for example, the model or your region may not be enabled for your account. Check the key's permissions on your provider's site.",
    action: 'check-key',
    actionLabel: 'Check API Key',
    extraActions: [SWITCH],
  },
  UNSUPPORTED_CAPABILITY: {
    icon: '⚠',
    title: 'Not supported by this provider',
    message:
      "Your selected AI provider or model can't handle this request (for example, this file type). Try without the attachment, or switch to another provider.",
    ...RETRY,
    extraActions: [SWITCH],
  },
  PROVIDER_ERROR: {
    icon: '⚠',
    title: 'AI temporarily unavailable',
    message: 'The AI provider is temporarily unavailable. Please try again later.',
    ...RETRY,
    extraActions: [SWITCH],
  },
  EMPTY_RESPONSE: {
    icon: '⚠',
    title: 'No answer received',
    message: "AI didn't return a response. Please try again.",
    ...RETRY,
  },
  INVALID_REQUEST: {
    icon: '⚠',
    title: "AI couldn't process that",
    message: 'The request could not be processed. Try a shorter question, or a smaller file.',
    ...RETRY,
  },
  SERVER_ERROR: {
    icon: '⚠',
    title: 'AI connection issue',
    message: "There's an issue connecting to AI right now. Please try again.",
    ...RETRY,
  },
  BACKEND_UNAVAILABLE: {
    icon: '⚠',
    title: "AI isn't available here yet",
    message: "This version of LifeOS isn't linked to the LifeOS AI service. Everything else keeps working normally.",
    ...RETRY,
  },
  BACKEND_NOT_RUNNING: {
    icon: '⚠',
    title: "AI backend isn't running",
    message: `LifeOS couldn't reach its AI service. If you run LifeOS on this computer, start the local AI server with "npm run serve:local", then try again.`,
    ...RETRY,
  },
  LOCAL_AI_UNREACHABLE: {
    icon: '⚡',
    title: "Couldn't reach Ollama",
    message:
      "LifeOS couldn't reach your Ollama server. Make sure Ollama is running on this device and the address is right. If LifeOS is opened from a website, Ollama must also allow that site (OLLAMA_ORIGINS) — see the Ollama setup steps on the Info page.",
    ...RETRY,
    extraActions: [SWITCH],
  },
  MODEL_UNAVAILABLE: {
    icon: '⚠',
    title: 'Model not available',
    message:
      "The selected model isn't available. For Ollama, install it with \"ollama pull <model>\"; otherwise choose another model on the Info page.",
    action: 'connect',
    actionLabel: 'Choose a Model',
    extraActions: [SWITCH],
  },
  CANCELLED: {
    icon: '■',
    title: 'Stopped',
    message: 'You stopped this request.',
    ...RETRY,
  },
  UNKNOWN_ERROR: {
    icon: '⚠',
    title: 'Something went wrong',
    message: 'Something went wrong while connecting to AI. Please try again.',
    ...RETRY,
  },
};

export function describeAiError(code: AiErrorCode): AiErrorView {
  return { code, ...(ERROR_COPY[code] ?? ERROR_COPY.UNKNOWN_ERROR) };
}

/** Error raised by the app-side AI client. Its message is always user-safe copy. */
export class AiRequestError extends Error {
  constructor(public readonly code: AiErrorCode) {
    super(describeAiError(code).message);
    this.name = 'AiRequestError';
  }
}

export function toAiErrorCode(err: unknown): AiErrorCode {
  return err instanceof AiRequestError ? err.code : 'UNKNOWN_ERROR';
}

export function isCancelled(err: unknown): boolean {
  return err instanceof AiRequestError && err.code === 'CANCELLED';
}

/**
 * One signal that aborts on the request timeout or when the caller cancels
 * (the user tapped Stop). `cancel` tells the two apart afterwards.
 */
export function requestSignal(timeoutMs: number, cancel?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);

  if (!cancel) return timeout;

  const any = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (any) return any([timeout, cancel]);

  // Older browsers without AbortSignal.any.
  const controller = new AbortController();
  const forward = (source: AbortSignal) => () => controller.abort(source.reason);
  timeout.addEventListener('abort', forward(timeout), { once: true });
  cancel.addEventListener('abort', forward(cancel), { once: true });
  if (cancel.aborted) controller.abort(cancel.reason);
  return controller.signal;
}

/** Maps a failed fetch to CANCELLED (user), TIMEOUT, or null (something else). */
export function abortCode(err: unknown, cancel?: AbortSignal): AiErrorCode | null {
  if (cancel?.aborted) return 'CANCELLED';
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : null;
}
