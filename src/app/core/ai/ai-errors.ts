import type { AiErrorCode } from './ai-contract';

/** What the user can do next. Every error maps to exactly one obvious action. */
export type AiErrorAction = 'connect' | 'retry' | 'check-key' | 'manual';

export interface AiErrorView {
  code: AiErrorCode;
  icon: string;
  title: string;
  message: string;
  action: AiErrorAction;
  actionLabel: string;
}

type ErrorCopy = Omit<AiErrorView, 'code'>;

const RETRY = { action: 'retry', actionLabel: 'Try Again' } as const;

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
    icon: '⚠',
    title: 'No AI credit available',
    message:
      "Your AI provider account doesn't have usable credit right now. Check billing on your provider's website, then try again.",
    ...RETRY,
  },
  RATE_LIMITED: {
    icon: '⏱',
    title: 'Too many requests',
    message: 'Your AI provider has temporarily limited requests. Please try again later.',
    ...RETRY,
  },
  PROVIDER_ERROR: {
    icon: '⚠',
    title: 'AI temporarily unavailable',
    message: 'The AI provider is temporarily unavailable. Please try again later.',
    ...RETRY,
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
