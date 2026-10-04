import type { AiContentBlock, AiErrorCode, AiModelInfo } from '../../../src/app/core/ai/ai-contract';
import type { AiProviderAdapter, CompletionInput, ProviderCall, ProviderErrorInfo } from './provider';
import { ProviderFailure, classifyCommon, cleanModelList, providerFetch, readJson } from './provider';

const API_BASE = 'https://api.openai.com/v1';

interface ChatCompletionPayload {
  choices?: { message?: { content?: string | null; refusal?: string | null } }[];
}

export const openAiProvider: AiProviderAdapter = {
  id: 'openai',

  async testConnection(apiKey: string, call: ProviderCall): Promise<void> {
    await providerFetch(call, `${API_BASE}/models`, { method: 'GET', headers: headers(apiKey) }, classifyOpenAiError);
  },

  async listModels(apiKey: string, call: ProviderCall): Promise<AiModelInfo[]> {
    const response = await providerFetch(call, `${API_BASE}/models`, { method: 'GET', headers: headers(apiKey) }, classifyOpenAiError);
    const payload = await readJson<{ data?: { id?: unknown }[] }>(response);
    const ids = (payload.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');

    return cleanModelList(ids.filter(isOpenAiChatModel).map((id) => ({ id, label: id })));
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
    }, classifyOpenAiError);

    const payload = await readJson<ChatCompletionPayload>(response);
    const message = payload.choices?.[0]?.message;
    const text = (message?.content ?? message?.refusal ?? '').trim();

    if (!text) {
      throw new ProviderFailure('EMPTY_RESPONSE');
    }

    return text;
  },
};

/**
 * OpenAI error codes (developers.openai.com → Error codes):
 * credit_balance_exhausted / insufficient_quota → out of credit;
 * *_spend_limit_exceeded / organization_usage_limit_exceeded → a cap the
 * account set or was given; rate_limit_exceeded → just slow down.
 */
export function classifyOpenAiError(error: ProviderErrorInfo): AiErrorCode {
  const has = (code: string) => error.markers.includes(code);

  if (has('credit_balance_exhausted') || has('insufficient_quota')) return 'QUOTA_EXCEEDED';
  if (error.markers.some((m) => m.endsWith('_spend_limit_exceeded') || m === 'organization_usage_limit_exceeded')) {
    return 'USAGE_LIMIT';
  }
  if (has('rate_limit_exceeded')) return 'RATE_LIMITED';
  if (has('model_not_found')) return 'MODEL_UNAVAILABLE';
  if (has('invalid_api_key')) return 'INVALID_KEY';

  return classifyCommon(error);
}

/** /v1/models lists every model (embeddings, audio, images…); keep the chat-completions text models. */
export function isOpenAiChatModel(id: string): boolean {
  return /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embedding|instruct|codex)/.test(id);
}

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
