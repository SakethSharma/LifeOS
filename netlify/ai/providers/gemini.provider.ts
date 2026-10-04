import type { AiContentBlock, AiErrorCode, AiModelInfo } from '../../../src/app/core/ai/ai-contract';
import type { AiProviderAdapter, CompletionInput, ProviderCall, ProviderErrorInfo } from './provider';
import { ProviderFailure, classifyCommon, cleanModelList, providerFetch, readJson } from './provider';

// Google Gemini API (ai.google.dev → API reference → generateContent).
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Gemini counts "thinking" tokens against maxOutputTokens, so a small limit
 * can leave no room for the visible answer. Allow headroom; reply length is
 * still kept short by the system prompt.
 */
const MIN_OUTPUT_TOKENS = 4096;

interface GenerateContentPayload {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

export const geminiProvider: AiProviderAdapter = {
  id: 'gemini',

  async testConnection(apiKey: string, call: ProviderCall): Promise<void> {
    // Listing models is free and proves the key works.
    await providerFetch(call, `${API_BASE}/models?pageSize=1`, { method: 'GET', headers: headers(apiKey) }, classifyGeminiError);
  },

  async listModels(apiKey: string, call: ProviderCall): Promise<AiModelInfo[]> {
    const response = await providerFetch(call, `${API_BASE}/models?pageSize=1000`, { method: 'GET', headers: headers(apiKey) }, classifyGeminiError);
    const payload = await readJson<{
      models?: { name?: unknown; displayName?: unknown; supportedGenerationMethods?: unknown }[];
    }>(response);

    return cleanModelList(
      (payload.models ?? []).flatMap((m) => {
        const id = typeof m.name === 'string' ? m.name.replace(/^models\//, '') : '';
        const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];

        if (!id.startsWith('gemini') || !methods.includes('generateContent') || /(embedding|image|tts|audio|live)/.test(id)) {
          return [];
        }

        return [{ id, label: typeof m.displayName === 'string' && m.displayName ? m.displayName : id }];
      }),
    );
  },

  async complete(apiKey: string, input: CompletionInput, call: ProviderCall): Promise<string> {
    const model = encodeURIComponent(call.model.replace(/^models\//, ''));

    const response = await providerFetch(
      call,
      `${API_BASE}/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { ...headers(apiKey), 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: input.messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: typeof m.content === 'string' ? [{ text: m.content }] : m.content.map(toGeminiPart),
          })),
          generationConfig: { maxOutputTokens: Math.max(input.maxTokens, MIN_OUTPUT_TOKENS) },
        }),
      },
      classifyGeminiError,
    );

    const payload = await readJson<GenerateContentPayload>(response);
    const text = (payload.candidates?.[0]?.content?.parts ?? [])
      .filter((part) => typeof part.text === 'string' && !part.thought)
      .map((part) => part.text)
      .join('')
      .trim();

    // Covers safety blocks (promptFeedback.blockReason) and empty candidates alike.
    if (!text) {
      throw new ProviderFailure('EMPTY_RESPONSE');
    }

    return text;
  },
};

/**
 * Gemini error statuses (ai.google.dev → API errors): 400 failed_precondition
 * (e.g. billing disabled), 401 authentication, 402 payment_required (prepay
 * credits depleted), 403 permission_denied, 404 model_not_found, 429 rate
 * limits. Older responses report a bad key as 400 with reason API_KEY_INVALID.
 * A 429 that talks about plan/billing is treated cautiously as a usage limit.
 */
export function classifyGeminiError(error: ProviderErrorInfo): AiErrorCode {
  const { status, message } = error;
  const has = (marker: string) => error.markers.includes(marker);

  if (status === 402 || has('payment_required')) return 'QUOTA_EXCEEDED';
  if (has('api_key_invalid') || message.includes('api key not valid') || has('authentication')) return 'INVALID_KEY';
  if (has('failed_precondition')) return 'BILLING_NOT_CONFIGURED';
  if (status === 429 && (message.includes('billing') || message.includes('plan'))) return 'USAGE_LIMIT';
  if (has('permission_denied')) return 'PERMISSION_DENIED';
  if (has('model_not_found') || has('not_found')) return 'MODEL_UNAVAILABLE';
  if (has('deadline_exceeded')) return 'TIMEOUT';

  return classifyCommon(error);
}

/** The key goes in the official header — never in the URL, where it could end up in logs. */
function headers(apiKey: string): Record<string, string> {
  return { 'x-goog-api-key': apiKey };
}

function toGeminiPart(block: AiContentBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { text: block.text };
    case 'image':
    case 'document':
      return { inlineData: { mimeType: block.mediaType, data: block.base64Data } };
  }
}
