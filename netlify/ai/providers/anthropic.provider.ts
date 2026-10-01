import type { AiContentBlock } from '../../../src/app/core/ai/ai-contract';
import type { AiProviderAdapter, CompletionInput, ProviderCall } from './provider';
import { ProviderFailure, providerFetch, readJson } from './provider';

const API_BASE = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

export const anthropicProvider: AiProviderAdapter = {
  id: 'anthropic',

  async testConnection(apiKey: string, call: ProviderCall): Promise<void> {
    await providerFetch(call, `${API_BASE}/models?limit=1`, { method: 'GET', headers: headers(apiKey) });
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
    });

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
