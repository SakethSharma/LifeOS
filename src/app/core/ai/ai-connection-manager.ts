import type {
  AiChatTurn,
  AiContentBlock,
  AiErrorCode,
  AiExtractTask,
  AiFinancialContext,
  AiModelInfo,
  AiProviderChoice,
  AiProviderId,
} from './ai-contract';
import { AI_PROVIDER_IDS, OLLAMA_PROVIDER, isValidModelId } from './ai-contract';
import type { AiBackendClient } from './ai-backend-client';
import type {
  AiConnectionStorage,
  ProviderConnectionStatus,
  StoredAiConnections,
  StoredOllamaConnection,
  StoredProviderConnection,
} from './ai-connection-storage';
import { AiRequestError, toAiErrorCode } from './ai-errors';
import { CHAT_MAX_TOKENS, EXTRACT_TASKS, buildChatSystemPrompt } from './ai-prompts';
import type { OllamaClient } from './ollama-client';
import { normalizeOllamaUrl } from './ollama-client';

/** Display-safe view of one provider's connection — never contains the credential. */
export interface ProviderConnectionView {
  provider: AiProviderChoice;
  /** Masked key; empty for Ollama, which has none. */
  keyHint: string;
  status: ProviderConnectionStatus;
  savedAt: string;
  checkedAt?: string;
  lastErrorCode?: AiErrorCode;
  /** Chosen model; absent for a cloud provider = the backend default. */
  model?: string;
  /** Ollama server address. */
  baseUrl?: string;
}

export interface AiConnectionsState {
  active: AiProviderChoice | null;
  providers: Partial<Record<AiProviderChoice, ProviderConnectionView>>;
  /** Providers with a save/test in progress. */
  busy: Partial<Record<AiProviderChoice, boolean>>;
}

export interface ModelListResult {
  models: AiModelInfo[];
  /** Cloud only: the model used when none is chosen. */
  defaultModel?: string;
}

export interface SaveKeyResult {
  /** Null when the key was saved. */
  errorCode: AiErrorCode | null;
  /** True when the provider accepted the key during save. */
  verified: boolean;
}

/** Errors that mean the saved key itself is wrong (as opposed to billing, limits, outages). */
const KEY_REJECTED: AiErrorCode[] = ['INVALID_KEY'];

/**
 * All AI provider connections on this device, and the one in use. Framework
 * free: AiService mirrors `state` into signals via `onChange`.
 *
 * Rules:
 * - each provider has its own sealed credential; saving one never touches another;
 * - every request uses exactly the active provider's id and its own credential
 *   (the backend also refuses a credential sealed for a different provider);
 * - a failed request is never retried through another provider automatically;
 * - switching or removing a provider never touches financial data.
 */
export class AiConnectionManager {
  private stored: StoredAiConnections;
  private busy: Partial<Record<AiProviderChoice, boolean>> = {};
  private current: AiConnectionsState;

  constructor(
    private readonly storage: AiConnectionStorage,
    private readonly client: AiBackendClient,
    private readonly onChange: (state: AiConnectionsState) => void = () => {},
    private readonly now: () => Date = () => new Date(),
    private readonly ollama: OllamaClient | null = null,
  ) {
    this.stored = storage.load();
    this.current = this.view();
  }

  get state(): AiConnectionsState {
    return this.current;
  }

  /** Configured providers that can be used: saved and not rejected. */
  usableProviders(): AiProviderChoice[] {
    const cloud: AiProviderChoice[] = AI_PROVIDER_IDS.filter((id) => {
      const entry = this.stored.providers[id];
      return !!entry && entry.status !== 'failed';
    });
    const ollama = this.stored.ollama;
    return ollama && ollama.status !== 'failed' ? [...cloud, OLLAMA_PROVIDER] : cloud;
  }

  /** Verifies and saves a key for one provider. A rejected key is never saved, and an existing key stays untouched. */
  async saveKey(provider: AiProviderId, apiKey: string): Promise<SaveKeyResult> {
    if (!apiKey.trim()) {
      return { errorCode: 'NOT_CONFIGURED', verified: false };
    }

    this.setBusy(provider, true);

    try {
      const result = await this.client.connect({ provider, apiKey: apiKey.trim() });

      // The backend answers for the provider it was asked about; anything else is refused.
      if (result.provider !== provider) {
        return { errorCode: 'UNKNOWN_ERROR', verified: false };
      }

      const timestamp = this.now().toISOString();
      const previousModel = this.stored.providers[provider]?.model;
      this.stored.providers[provider] = {
        ...(previousModel ? { model: previousModel } : {}),
        credential: result.credential,
        keyHint: result.keyHint,
        savedAt: timestamp,
        status: result.verified ? 'connected' : 'not_tested',
        ...(result.verified ? { checkedAt: timestamp } : {}),
        ...(result.verifyErrorCode ? { lastErrorCode: result.verifyErrorCode } : {}),
      };

      // The first usable provider becomes active; adding another never switches silently.
      if (!this.stored.active || !this.usableProviders().includes(this.stored.active)) {
        this.stored.active = provider;
      }

      this.persist();
      return { errorCode: null, verified: result.verified };
    } catch (err) {
      return { errorCode: toAiErrorCode(err), verified: false };
    } finally {
      this.setBusy(provider, false);
    }
  }

  /**
   * Saves the local Ollama server and model after checking that the server
   * answers and the model is installed. If the server can't be reached the
   * settings are still saved (nothing secret) but marked "Not tested"; a model
   * that isn't installed is refused.
   */
  async saveOllama(baseUrl: string, model: string): Promise<SaveKeyResult> {
    const origin = normalizeOllamaUrl(baseUrl);

    if (!origin || !this.ollama) {
      return { errorCode: 'INVALID_REQUEST', verified: false };
    }

    if (!model.trim()) {
      return { errorCode: 'MODEL_UNAVAILABLE', verified: false };
    }

    this.setBusy(OLLAMA_PROVIDER, true);

    try {
      let verifyErrorCode: AiErrorCode | undefined;

      try {
        const installed = await this.ollama.listModels(origin);
        if (!installed.some((m) => m.id === model.trim())) {
          return { errorCode: 'MODEL_UNAVAILABLE', verified: false };
        }
      } catch (err) {
        verifyErrorCode = toAiErrorCode(err);
      }

      const timestamp = this.now().toISOString();
      this.stored.ollama = {
        baseUrl: origin,
        model: model.trim(),
        savedAt: timestamp,
        status: verifyErrorCode ? 'not_tested' : 'connected',
        ...(verifyErrorCode ? { lastErrorCode: verifyErrorCode } : { checkedAt: timestamp }),
      };

      if (!this.stored.active || !this.usableProviders().includes(this.stored.active)) {
        this.stored.active = OLLAMA_PROVIDER;
      }

      this.persist();
      return { errorCode: null, verified: !verifyErrorCode };
    } finally {
      this.setBusy(OLLAMA_PROVIDER, false);
    }
  }

  /** Models installed on an Ollama server (it doesn't need to be saved yet). */
  async listOllamaModels(baseUrl: string): Promise<AiModelInfo[]> {
    const origin = normalizeOllamaUrl(baseUrl);

    if (!origin || !this.ollama) {
      throw new AiRequestError('INVALID_REQUEST');
    }

    return this.ollama.listModels(origin);
  }

  /** Models available to a provider. Ollama lists its installed models; cloud providers ask through the backend. */
  async listModels(provider: AiProviderChoice): Promise<ModelListResult> {
    if (provider === OLLAMA_PROVIDER) {
      const ollama = this.stored.ollama;
      if (!ollama) throw new AiRequestError('NOT_CONFIGURED');
      return { models: await this.listOllamaModels(ollama.baseUrl) };
    }

    const entry = this.stored.providers[provider];
    if (!entry) throw new AiRequestError('NOT_CONFIGURED');

    const result = await this.client.models(provider, entry.credential);
    // Same rule as every request: the answer must be for the provider asked about.
    if (result.provider !== provider) throw new AiRequestError('UNKNOWN_ERROR');

    return { models: result.models, defaultModel: result.defaultModel };
  }

  /** Chooses a model for one provider. `null` (cloud only) goes back to the backend default. */
  setModel(provider: AiProviderChoice, model: string | null): boolean {
    if (provider === OLLAMA_PROVIDER) {
      const ollama = this.stored.ollama;
      if (!ollama || !model || !model.trim() || model.length > 200) return false;
      this.stored.ollama = { ...ollama, model: model.trim() };
      this.persist();
      return true;
    }

    const entry = this.stored.providers[provider];
    if (!entry || (model !== null && !isValidModelId(model))) return false;

    const { model: _previous, ...rest } = entry;
    this.stored.providers[provider] = model ? { ...rest, model } : rest;
    this.persist();
    return true;
  }

  /** Re-checks a saved connection with a real call. */
  async testProvider(provider: AiProviderChoice): Promise<AiErrorCode | null> {
    if (provider === OLLAMA_PROVIDER) {
      return this.testOllama();
    }

    const entry = this.stored.providers[provider];

    if (!entry) {
      return 'NOT_CONFIGURED';
    }

    this.setBusy(provider, true);

    try {
      await this.client.test(provider, entry.credential);
      this.recordOutcome(provider, null);
      return null;
    } catch (err) {
      const code = toAiErrorCode(err);
      this.recordOutcome(provider, code);
      return code;
    } finally {
      this.setBusy(provider, false);
    }
  }

  /** Forgets one provider's key (or the Ollama settings). Other providers and all financial data are untouched. */
  removeProvider(provider: AiProviderChoice): void {
    if (provider === OLLAMA_PROVIDER) {
      if (!this.stored.ollama) return;
      delete this.stored.ollama;
    } else {
      if (!this.stored.providers[provider]) return;
      delete this.stored.providers[provider];
    }

    if (this.stored.active === provider) {
      this.stored.active = this.usableProviders()[0] ?? null;
    }

    this.persist();
  }

  /** Makes a configured, usable provider the one used for new requests. */
  setActiveProvider(provider: AiProviderChoice): boolean {
    if (!this.usableProviders().includes(provider)) {
      return false;
    }

    this.stored.active = provider;
    this.persist();
    return true;
  }

  async chat(
    history: AiChatTurn[],
    message: string,
    context: AiFinancialContext | null,
    attachments: AiContentBlock[] = [],
    cancel?: AbortSignal,
  ): Promise<{ text: string; provider: AiProviderChoice }> {
    const active = this.activeConnection();

    // Ollama: the conversation goes straight to the user's own computer, never through the backend.
    if (active.kind === 'ollama') {
      const { ollama, entry } = active;
      const text = await this.track(OLLAMA_PROVIDER, () =>
        ollama.chat({
          baseUrl: entry.baseUrl,
          model: entry.model,
          system: buildChatSystemPrompt(context),
          turns: [...history, { role: 'user', content: message }],
          blocks: attachments,
          maxTokens: CHAT_MAX_TOKENS,
          cancel,
        }),
      );
      return { text, provider: OLLAMA_PROVIDER };
    }

    const { provider, entry } = active;
    const request = {
      provider,
      history,
      message,
      context,
      ...(attachments.length ? { attachments } : {}),
      ...(entry.model ? { model: entry.model } : {}),
    };
    const text = await this.track(provider, () => this.client.chat(request, entry.credential, cancel));
    return { text, provider };
  }

  async extract(task: AiExtractTask, blocks: AiContentBlock[], cancel?: AbortSignal): Promise<string> {
    const active = this.activeConnection();

    if (active.kind === 'ollama') {
      const { ollama, entry } = active;
      const config = EXTRACT_TASKS[task];
      return this.track(OLLAMA_PROVIDER, () =>
        ollama.chat({
          baseUrl: entry.baseUrl,
          model: entry.model,
          system: config.system,
          turns: [{ role: 'user', content: config.instructions }],
          blocks,
          maxTokens: config.maxTokens,
          json: true,
          cancel,
        }),
      );
    }

    const { provider, entry } = active;
    return this.track(provider, () =>
      this.client.extract({ provider, task, blocks, ...(entry.model ? { model: entry.model } : {}) }, entry.credential, cancel),
    );
  }

  /** The active provider and its own settings, read together so they can never mismatch. */
  private activeConnection():
    | { kind: 'cloud'; provider: AiProviderId; entry: StoredProviderConnection }
    | { kind: 'ollama'; ollama: OllamaClient; entry: StoredOllamaConnection } {
    const provider = this.stored.active;

    if (provider === OLLAMA_PROVIDER) {
      const entry = this.stored.ollama;
      if (!entry || !this.ollama) throw new AiRequestError('NOT_CONFIGURED');
      return { kind: 'ollama', ollama: this.ollama, entry };
    }

    const entry = provider ? this.stored.providers[provider] : undefined;

    if (!provider || !entry) {
      throw new AiRequestError('NOT_CONFIGURED');
    }

    if (entry.status === 'failed') {
      throw new AiRequestError('INVALID_KEY');
    }

    return { kind: 'cloud', provider, entry };
  }

  private async testOllama(): Promise<AiErrorCode | null> {
    const entry = this.stored.ollama;

    if (!entry || !this.ollama) {
      return 'NOT_CONFIGURED';
    }

    this.setBusy(OLLAMA_PROVIDER, true);

    try {
      const installed = await this.ollama.listModels(entry.baseUrl);
      const code: AiErrorCode | null = installed.some((m) => m.id === entry.model) ? null : 'MODEL_UNAVAILABLE';
      this.recordOutcome(OLLAMA_PROVIDER, code);
      return code;
    } catch (err) {
      const code = toAiErrorCode(err);
      this.recordOutcome(OLLAMA_PROVIDER, code);
      return code;
    } finally {
      this.setBusy(OLLAMA_PROVIDER, false);
    }
  }

  /** A real request is also a test: success confirms the key, a rejected key marks it failed. */
  private async track<T>(provider: AiProviderChoice, run: () => Promise<T>): Promise<T> {
    try {
      const result = await run();
      this.recordOutcome(provider, null);
      return result;
    } catch (err) {
      const code = toAiErrorCode(err);
      if (KEY_REJECTED.includes(code)) {
        this.recordOutcome(provider, code);
      }
      throw err;
    }
  }

  private recordOutcome(provider: AiProviderChoice, code: AiErrorCode | null): void {
    if (provider === OLLAMA_PROVIDER) {
      const entry = this.stored.ollama;
      if (!entry) return;
      // Ollama has no key to reject; it's only ever connected or not (yet) reachable.
      const { lastErrorCode: _previous, ...rest } = entry;
      this.stored.ollama = {
        ...rest,
        status: code === null ? 'connected' : 'not_tested',
        checkedAt: this.now().toISOString(),
        ...(code ? { lastErrorCode: code } : {}),
      };
      this.persist();
      return;
    }

    const entry = this.stored.providers[provider];

    if (!entry) {
      return;
    }

    const timestamp = this.now().toISOString();
    let status: ProviderConnectionStatus = entry.status;

    if (code === null) {
      status = 'connected';
    } else if (KEY_REJECTED.includes(code)) {
      status = 'failed';
    }

    const { lastErrorCode: _previous, ...rest } = entry;
    this.stored.providers[provider] = {
      ...rest,
      status,
      checkedAt: timestamp,
      ...(code ? { lastErrorCode: code } : {}),
    };

    // A rejected active key: keep it selected (so the error is explained), but it can't be used.
    this.persist();
  }

  private setBusy(provider: AiProviderChoice, busy: boolean): void {
    this.busy = { ...this.busy, [provider]: busy };
    this.emit();
  }

  private persist(): void {
    this.storage.save(this.stored);
    this.emit();
  }

  private emit(): void {
    this.current = this.view();
    this.onChange(this.current);
  }

  private view(): AiConnectionsState {
    const providers: AiConnectionsState['providers'] = {};

    for (const id of AI_PROVIDER_IDS) {
      const entry = this.stored.providers[id];
      if (entry) {
        providers[id] = {
          provider: id,
          keyHint: entry.keyHint,
          status: entry.status,
          savedAt: entry.savedAt,
          ...(entry.checkedAt ? { checkedAt: entry.checkedAt } : {}),
          ...(entry.lastErrorCode ? { lastErrorCode: entry.lastErrorCode } : {}),
          ...(entry.model ? { model: entry.model } : {}),
        };
      }
    }

    const ollama = this.stored.ollama;
    if (ollama) {
      providers[OLLAMA_PROVIDER] = {
        provider: OLLAMA_PROVIDER,
        keyHint: '',
        status: ollama.status,
        savedAt: ollama.savedAt,
        model: ollama.model,
        baseUrl: ollama.baseUrl,
        ...(ollama.checkedAt ? { checkedAt: ollama.checkedAt } : {}),
        ...(ollama.lastErrorCode ? { lastErrorCode: ollama.lastErrorCode } : {}),
      };
    }

    return { active: this.stored.active, providers, busy: { ...this.busy } };
  }
}
