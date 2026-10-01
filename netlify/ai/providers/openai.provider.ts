import type { AiContentBlock } from '../../../src/app/core/ai/ai-contract';
import type { AiProviderAdapter, CompletionInput, ProviderCall } from './provider';
import { ProviderFailure, providerFetch, readJson } from './provider';

const API_BASE = 'https://api.openai.com/v1';

interface ChatCompletionPayload {
  choices?: { message?: { content?: string | null; refusal?: string | null } }[];
}

export const openAiProvider: AiProviderAdapter = {
  id: 'openai',

  async testConnection(apiKey: string, call: ProviderCall): Promise<void> {
    await providerFetch(call, `${API_BASE}/models`, { method: 'GET', headers: headers(apiKey) });
  },

  async complete(apiKey: string, input: CompletionInput, call: ProviderCall): Promise<string> {
    const response = await providerFetch(call, `${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { ...headers(apiKey), 'content-type': 'application/json' },
      body: JSON.stringify({
        model: call.model,
        max_completion_tokens: input.maxTokens,
        messages: [
          { role: 'system', content: input.system },
          ...input.messages.map((m) => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : m.content.map(toOpenAiPart),
          })),
        ],
      }),
    });

    const payload = await readJson<ChatCompletionPayload>(response);
    const message = payload.choices?.[0]?.message;
    const text = (message?.content ?? message?.refusal ?? '').trim();

    if (!text) {
      throw new ProviderFailure('EMPTY_RESPONSE');
    }

    return text;
  },
};

function headers(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

function toOpenAiPart(block: AiContentBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'image':
      return { type: 'image_url', image_url: { url: `data:${block.mediaType};base64,${block.base64Data}` } };
    case 'document':
      return {
        type: 'file',
        file: { filename: 'document.pdf', file_data: `data:${block.mediaType};base64,${block.base64Data}` },
      };
  }
}
