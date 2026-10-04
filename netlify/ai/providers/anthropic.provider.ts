import type { AiContentBlock, AiErrorCode, AiModelInfo } from '../../../src/app/core/ai/ai-contract';
import type { AiProviderAdapter, CompletionInput, ProviderCall, ProviderErrorInfo } from './provider';
import { ProviderFailure, classifyCommon, cleanModelList, providerFetch, readJson } from './provider';

const API_BASE = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

export const anthropicProvider: AiProviderAdapter = {
  id: 'anthropic',

  async testConnection(apiKey: string, call: ProviderCall): Promise<void> {
    await providerFetch(call, `${API_BASE}/models?limit=1`, { method: 'GET', headers: headers(apiKey) }, classifyAnthropicError);
  },

  async listModels(apiKey: string, call: ProviderCall): Promise<AiModelInfo[]> {
    const response = await providerFetch(call, `${API_BASE}/models?limit=100`, { method: 'GET', headers: headers(apiKey) }, classifyAnthropicError);
    const payload = await readJson<{ data?: { id?: unknown; display_name?: unknown }[] }>(response);

    return cleanModelList(
      (payload.data ?? [])
        .filter((m): m is { id: string; display_name?: unknown } => typeof m.id === 'string')
        .map((m) => ({ id: m.id, label: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.id })),
    );
  },

  async complete(apiKey: string, input: CompletionInput, call: ProviderCall): Promise<string> {
    const response = await providerFetch(call, `${API_BASE}/messages`, {
      method: 'POST',
      headers: { ...headers(apiKey), 'content-type': 'application/json' },
      body: JSON.stringify({
        model: call.model,
        max_tokens: input.maxTokens,
        system: input.system,
        messages: input.messages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content.map(toAnthropicBlock),
        })),
      }),
    }, classifyAnthropicError);

    const payload = await readJson<{ content?: { type: string; text?: string }[] }>(response);
    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!text) {
      throw new ProviderFailure('EMPTY_RESPONSE');
    }

    return text;
  },
};

/**
 * Anthropic error types (platform.claude.com → API errors): 402 billing_error;
 * a 400 can mean an organization/workspace spend limit was reached; a 429 is
 * usually a rate limit but can be a monthly spend cap — so "spend" wording is
 * treated cautiously as a usage limit, not as "no credit".
 */
export function classifyAnthropicError(error: ProviderErrorInfo): AiErrorCode {
  const { status, message } = error;
  const has = (type: string) => error.markers.includes(type);

  if (has('billing_error') || status === 402) return 'QUOTA_EXCEEDED';
  if (status === 400 && message.includes('credit balance')) return 'QUOTA_EXCEEDED';
  if ((status === 400 || status === 429) && message.includes('spend')) return 'USAGE_LIMIT';
  if (has('rate_limit_error')) return 'RATE_LIMITED';
  if (has('authentication_error')) return 'INVALID_KEY';
  if (has('permission_error')) return 'PERMISSION_DENIED';
  if (has('not_found_error')) return 'MODEL_UNAVAILABLE';
  if (has('timeout_error')) return 'TIMEOUT';
  if (has('overloaded_error') || has('api_error')) return 'PROVIDER_ERROR';

  return classifyCommon(error);
}

function headers(apiKey: string): Record<string, string> {
  return { 'x-api-key': apiKey, 'anthropic-version': API_VERSION };
}

function toAnthropicBlock(block: AiContentBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'image':
      return { type: 'image', source: { type: 'base64', media_type: block.mediaType, data: block.base64Data } };
    case 'document':
      return { type: 'document', source: { type: 'base64', media_type: block.mediaType, data: block.base64Data } };
  }
}
