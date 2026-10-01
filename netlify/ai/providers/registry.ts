import type { AiProviderId } from '../../../src/app/core/ai/ai-contract';
import type { AiProviderAdapter } from './provider';
import { anthropicProvider } from './anthropic.provider';
import { openAiProvider } from './openai.provider';

const PROVIDERS: Record<AiProviderId, AiProviderAdapter> = {
  openai: openAiProvider,
  anthropic: anthropicProvider,
};

export function getProvider(id: AiProviderId): AiProviderAdapter {
  return PROVIDERS[id];
}
