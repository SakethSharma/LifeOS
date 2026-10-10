import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import type {
  AiChatTurn,
  AiContentBlock,
  AiErrorCode,
  AiExtractTask,
  AiFinancialContext,
  AiModelInfo,
  AiProviderChoice,
  AiProviderId,
} from '../ai/ai-contract';
import { AiBackendClient } from '../ai/ai-backend-client';
import { nativeBackendBaseUrl } from '../ai/ai-backend.config';
import { AiConnectionStorage } from '../ai/ai-connection-storage';
import { AiConnectionManager } from '../ai/ai-connection-manager';
import type { AiConnectionsState, ModelListResult, ProviderConnectionView, SaveKeyResult } from '../ai/ai-connection-manager';
import { OllamaClient } from '../ai/ollama-client';
import { getBillingUrl } from '../ai/ai-provider-guides';

export type AiConnectionState = 'not_configured' | 'testing' | 'connected' | 'not_tested' | 'error';

export interface AiConnectionStatus {
  state: AiConnectionState;
  errorCode?: AiErrorCode;
}

/**
 * The single AI entry point for the whole app — AI Insights and the salary
 * document reader share the same connections and the same active provider.
 * Components never see endpoints or credentials; they get text back or an
 * AiRequestError.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly stateSignal = signal<AiConnectionsState>({ active: null, providers: {}, busy: {} });

  private readonly manager = new AiConnectionManager(
    new AiConnectionStorage(safeLocalStorage()),
    new AiBackendClient({
      baseUrl: resolveBackendBaseUrl(),
      fetch: (input, init) => fetch(input, init),
      isOnline: () => isNavigatorOnline(),
    }),
    (state) => this.stateSignal.set(state),
    undefined,
    new OllamaClient({ fetch: (input, init) => fetch(input, init) }),
  );

  /** Every configured provider (display-safe: masked hint and status only). */
  readonly connections = computed(() => this.stateSignal().providers);
  readonly activeProvider = computed(() => this.stateSignal().active);
  /** The active provider's connection, or null. */
  readonly connection = computed<ProviderConnectionView | null>(() => {
    const { active, providers } = this.stateSignal();
    return active ? (providers[active] ?? null) : null;
  });
  /** Configured providers that can be selected (saved and not rejected). */
  readonly usableProviders = computed(() =>
    (Object.values(this.stateSignal().providers) as ProviderConnectionView[])
      .filter((c) => c.status !== 'failed')
      .map((c) => c.provider),
  );
  /** True when the active provider can be used for requests. */
  readonly isConnected = computed(() => {
    const c = this.connection();
    return !!c && c.status !== 'failed';
  });
  readonly hasAlternativeProvider = computed(() => this.usableProviders().length > 1);

  /** Status of the active provider, for headers and badges. */
  readonly status = computed<AiConnectionStatus>(() => {
    const { active, busy } = this.stateSignal();
    const c = this.connection();

    if (active && busy[active]) return { state: 'testing' };
    if (!c) return { state: 'not_configured' };
    if (c.status === 'failed') return { state: 'error', errorCode: c.lastErrorCode };
    if (c.status === 'not_tested') return { state: 'not_tested', errorCode: c.lastErrorCode };
    return { state: 'connected' };
  });

  readonly online = signal(isNavigatorOnline());

  constructor() {
    this.stateSignal.set(this.manager.state);

    if (typeof window === 'undefined') return;

    const update = () => this.online.set(isNavigatorOnline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  }

  isBusy(provider: AiProviderChoice): boolean {
    return !!this.stateSignal().busy[provider];
  }

  /** Verifies (when possible) and saves a key for one provider. Other providers are untouched. */
  saveKey(provider: AiProviderId, apiKey: string): Promise<SaveKeyResult> {
    return this.manager.saveKey(provider, apiKey);
  }

  /** Checks (when reachable) and saves the local Ollama server and model. */
  saveOllama(baseUrl: string, model: string): Promise<SaveKeyResult> {
    return this.manager.saveOllama(baseUrl, model);
  }

  /** Models installed on an Ollama server, before or after saving it. */
  listOllamaModels(baseUrl: string): Promise<AiModelInfo[]> {
    return this.manager.listOllamaModels(baseUrl);
  }

  /** Models a configured provider offers. */
  listModels(provider: AiProviderChoice): Promise<ModelListResult> {
    return this.manager.listModels(provider);
  }

  setModel(provider: AiProviderChoice, model: string | null): boolean {
    return this.manager.setModel(provider, model);
  }

  /** Re-checks one provider's saved connection with a real call. */
  testProvider(provider: AiProviderChoice): Promise<AiErrorCode | null> {
    return this.manager.testProvider(provider);
  }

  removeProvider(provider: AiProviderChoice): void {
    this.manager.removeProvider(provider);
  }

  setActiveProvider(provider: AiProviderChoice): boolean {
    return this.manager.setActiveProvider(provider);
  }

  /** Chat with the active provider; resolves with the reply and which provider gave it. */
  chatWithProvider(
    history: AiChatTurn[],
    message: string,
    context: AiFinancialContext | null,
    attachments: AiContentBlock[] = [],
    cancel?: AbortSignal,
  ): Promise<{ text: string; provider: AiProviderChoice }> {
    return this.manager.chat(history, message, context, attachments, cancel);
  }

  async chat(
    history: AiChatTurn[],
    message: string,
    context: AiFinancialContext | null,
    attachments: AiContentBlock[] = [],
    cancel?: AbortSignal,
  ): Promise<string> {
    return (await this.manager.chat(history, message, context, attachments, cancel)).text;
  }

  /** `cancel` stops the request (→ AiRequestError CANCELLED); used by "Stop". */
  extract(task: AiExtractTask, blocks: AiContentBlock[], cancel?: AbortSignal): Promise<string> {
    return this.manager.extract(task, blocks, cancel);
  }

  /**
   * Opens the provider's official billing page in a new tab, leaving LifeOS
   * (and any chat or form state) exactly as it is. The URL comes only from
   * the fixed provider list.
   */
  openBillingPage(provider: AiProviderChoice | null = this.activeProvider()): boolean {
    const url = provider ? getBillingUrl(provider) : null;

    if (!url || typeof window === 'undefined') {
      return false;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  }
}

function resolveBackendBaseUrl(): string | null {
  if (!Capacitor.isNativePlatform()) {
    return '';
  }

  return nativeBackendBaseUrl();
}

function isNavigatorOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
