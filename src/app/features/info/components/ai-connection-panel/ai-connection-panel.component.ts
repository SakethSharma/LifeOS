import { Component, ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';
import { AiService } from '../../../../core/services/ai.service';
import {
  AI_PROVIDERS,
  CHATGPT_INFO,
  OLLAMA_INFO,
  getProviderInfo,
  providerLabel,
} from '../../../../core/ai/ai-provider-guides';
import type { AiProviderInfo } from '../../../../core/ai/ai-provider-guides';
import { OLLAMA_PROVIDER, isAiProviderId } from '../../../../core/ai/ai-contract';
import type { AiErrorCode, AiModelInfo, AiProviderChoice, AiProviderId } from '../../../../core/ai/ai-contract';
import { OLLAMA_DEFAULT_URL, normalizeOllamaUrl } from '../../../../core/ai/ollama-client';
import { describeAiError, toAiErrorCode } from '../../../../core/ai/ai-errors';
import type { AiErrorAction, AiErrorView } from '../../../../core/ai/ai-errors';
import type { ProviderConnectionView } from '../../../../core/ai/ai-connection-manager';
import { AiStatusCardComponent } from '../../../../shared/components/ai-status-card/ai-status-card.component';

/** Outcome of the last save/test for one provider, shown under its card. */
type RowResult =
  | { kind: 'saved' }
  | { kind: 'saved-unverified'; code?: AiErrorCode }
  | { kind: 'tested' }
  | { kind: 'error'; code: AiErrorCode };

interface ProviderRow {
  info: AiProviderInfo;
  connection: ProviderConnectionView | null;
  isActive: boolean;
  busy: boolean;
}

/** A provider's model list, loaded on request. */
interface ModelListState {
  loading: boolean;
  models: AiModelInfo[] | null;
  defaultModel?: string;
  errorCode?: AiErrorCode;
}

interface ActiveOption {
  id: AiProviderChoice;
  label: string;
  statusClass: string;
  statusLabel: string;
}

const STATUS_LABELS = {
  connected: 'Connected',
  not_tested: 'Not tested',
  failed: 'Connection failed',
} as const;

/**
 * Connect and manage AI providers. Each provider keeps its own key; a typed
 * key lives only in this component's memory until "Save & Test", is cleared
 * after saving, and only a masked hint is ever shown again.
 */
@Component({
  selector: 'app-ai-connection-panel',
  standalone: true,
  imports: [AiStatusCardComponent],
  templateUrl: './ai-connection-panel.component.html',
  styleUrl: './ai-connection-panel.component.scss',
})
export class AiConnectionPanelComponent {
  private ai = inject(AiService);

  /** "Don't have a key? See how" — with the provider whose guide should open. */
  guideRequested = output<AiProviderId>();

  private keyInputRef = viewChild<ElementRef<HTMLInputElement>>('keyField');

  readonly providers = AI_PROVIDERS;
  readonly ollamaInfo = OLLAMA_INFO;
  readonly chatGptInfo = CHATGPT_INFO;
  readonly ollamaDefaultUrl = OLLAMA_DEFAULT_URL;
  /** The exact origin Ollama must allow (OLLAMA_ORIGINS) when LifeOS is opened from a website. */
  readonly appOrigin = typeof location === 'undefined' ? '' : location.origin;
  readonly appIsHttps = typeof location !== 'undefined' && location.protocol === 'https:';

  activeProvider = this.ai.activeProvider;

  editing = signal<AiProviderId | null>(null);
  keyInput = signal('');
  showKey = signal(false);
  validationMessage = signal<string | null>(null);
  confirmingRemove = signal<AiProviderId | null>(null);
  results = signal<Partial<Record<AiProviderId, RowResult>>>({});

  rows = computed<ProviderRow[]>(() => {
    const connections = this.ai.connections();
    const active = this.ai.activeProvider();
    // Read through isBusy so busy changes re-render.
    return this.providers.map((info) => ({
      info,
      connection: connections[info.id] ?? null,
      isActive: active === info.id,
      busy: this.ai.isBusy(info.id),
    }));
  });

  usableRows = computed(() => this.rows().filter((r) => r.connection && r.connection.status !== 'failed'));

  /** Everything that can answer requests, cloud and local, for the "AI Provider" choice. */
  activeOptions = computed<ActiveOption[]>(() => {
    const connections = this.ai.connections();
    return this.ai.usableProviders().map((id) => {
      const c = connections[id];
      return {
        id,
        label: providerLabel(id) + (c?.model ? ` · ${c.model}` : ''),
        statusClass: c ? c.status : 'none',
        statusLabel: c ? STATUS_LABELS[c.status] : 'Not configured',
      };
    });
  });

  // ---- Models (per provider) ----
  modelLists = signal<Partial<Record<AiProviderChoice, ModelListState>>>({});

  // ---- Ollama ----
  ollama = computed(() => this.ai.connections()[OLLAMA_PROVIDER] ?? null);
  ollamaBusy = computed(() => {
    this.ai.connections();
    return this.ai.isBusy(OLLAMA_PROVIDER);
  });
  ollamaIsActive = computed(() => this.ai.activeProvider() === OLLAMA_PROVIDER);
  ollamaEditing = signal(false);
  ollamaUrl = signal(OLLAMA_DEFAULT_URL);
  ollamaModel = signal('');
  ollamaModels = signal<AiModelInfo[] | null>(null);
  ollamaLoading = signal(false);
  ollamaUrlError = signal<string | null>(null);
  ollamaResult = signal<RowResult | null>(null);
  confirmingOllamaRemove = signal(false);

  statusLabel(row: ProviderRow): string {
    return row.connection ? STATUS_LABELS[row.connection.status] : 'Not configured';
  }

  statusClass(row: ProviderRow): string {
    return row.connection ? row.connection.status : 'none';
  }

  errorView(code: AiErrorCode): AiErrorView {
    const view = describeAiError(code);

    // On this panel the fix for a bad key is right here: update it.
    if (code === 'INVALID_KEY') {
      return {
        ...view,
        title: "We couldn't connect to your AI provider",
        message: 'Please check your API key and try again.',
        action: 'check-key',
        actionLabel: 'Update Key',
        extraActions: [],
      };
    }

    return view;
  }

  verificationNote(row: ProviderRow): string {
    const code = row.connection?.lastErrorCode;
    return code ? describeAiError(code).title.toLowerCase() : 'the check didn’t finish';
  }

  setActive(provider: AiProviderChoice): void {
    this.ai.setActiveProvider(provider);
  }

  startEdit(provider: AiProviderId): void {
    this.editing.set(provider);
    this.keyInput.set('');
    this.showKey.set(false);
    this.validationMessage.set(null);
    this.confirmingRemove.set(null);
    this.focusKeyInput();
  }

  cancelEdit(): void {
    this.editing.set(null);
    this.keyInput.set('');
    this.validationMessage.set(null);
  }

  onKeyInput(event: Event): void {
    this.keyInput.set((event.target as HTMLInputElement).value);
    this.validationMessage.set(null);
  }

  clearKey(): void {
    this.keyInput.set('');
    this.validationMessage.set(null);
    this.focusKeyInput();
  }

  toggleShowKey(): void {
    this.showKey.update((v) => !v);
  }

  async saveKey(provider: AiProviderId): Promise<void> {
    if (this.ai.isBusy(provider)) return;

    const key = this.keyInput().trim();

    if (!key) {
      this.validationMessage.set('Paste your API key first.');
      this.focusKeyInput();
      return;
    }

    if (/\s/.test(key)) {
      this.validationMessage.set("That doesn't look like a complete key — it contains spaces. Try copying it again.");
      return;
    }

    this.setResult(provider, null);
    const result = await this.ai.saveKey(provider, key);

    if (result.errorCode) {
      this.setResult(provider, { kind: 'error', code: result.errorCode });
      return;
    }

    // Saved: forget the typed key immediately.
    this.keyInput.set('');
    this.showKey.set(false);
    this.editing.set(null);
    this.setResult(
      provider,
      result.verified
        ? { kind: 'saved' }
        : { kind: 'saved-unverified', code: this.ai.connections()[provider]?.lastErrorCode },
    );
  }

  async testProvider(provider: AiProviderId): Promise<void> {
    if (this.ai.isBusy(provider)) return;

    this.setResult(provider, null);
    const code = await this.ai.testProvider(provider);
    this.setResult(provider, code ? { kind: 'error', code } : { kind: 'tested' });
  }

  askRemove(provider: AiProviderId): void {
    this.confirmingRemove.set(provider);
  }

  confirmRemove(provider: AiProviderId): void {
    this.ai.removeProvider(provider);
    this.confirmingRemove.set(null);
    this.setResult(provider, null);
    if (this.editing() === provider) this.cancelEdit();
  }

  openBilling(provider: AiProviderId): void {
    this.ai.openBillingPage(provider);
  }

  onRowAction(provider: AiProviderId, action: AiErrorAction): void {
    switch (action) {
      case 'billing':
        this.openBilling(provider);
        break;
      case 'check-key':
        this.startEdit(provider);
        break;
      default:
        if (this.editing() === provider && this.keyInput().trim()) {
          void this.saveKey(provider);
        } else if (this.ai.connections()[provider]) {
          void this.testProvider(provider);
        } else {
          this.startEdit(provider);
        }
    }
  }

  requestGuide(): void {
    const firstUnconfigured = this.rows().find((r) => !r.connection)?.info.id;
    const active = this.activeProvider();
    this.guideRequested.emit(this.editing() ?? firstUnconfigured ?? (isAiProviderId(active) ? active : 'openai'));
  }

  // ---- Model selection ----

  modelList(provider: AiProviderChoice): ModelListState | undefined {
    return this.modelLists()[provider];
  }

  /** Loads (or refreshes) the models a configured provider offers. */
  async loadModels(provider: AiProviderChoice): Promise<void> {
    if (this.modelLists()[provider]?.loading) return;

    this.setModelList(provider, { loading: true, models: this.modelLists()[provider]?.models ?? null });

    try {
      const result = await this.ai.listModels(provider);
      this.setModelList(provider, { loading: false, models: result.models, defaultModel: result.defaultModel });
    } catch (err) {
      this.setModelList(provider, { loading: false, models: null, errorCode: toAiErrorCode(err) });
    }
  }

  onModelSelected(provider: AiProviderChoice, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.ai.setModel(provider, value || null);
  }

  /** True when the saved model is no longer offered by the provider. */
  savedModelMissing(provider: AiProviderChoice): boolean {
    const list = this.modelLists()[provider]?.models;
    const model = this.ai.connections()[provider]?.model;
    return !!list && !!model && !list.some((m) => m.id === model);
  }

  // ---- Ollama ----

  startOllamaEdit(): void {
    const current = this.ollama();
    this.ollamaEditing.set(true);
    this.ollamaUrl.set(current?.baseUrl ?? OLLAMA_DEFAULT_URL);
    this.ollamaModel.set(current?.model ?? '');
    this.ollamaModels.set(null);
    this.ollamaUrlError.set(null);
    this.ollamaResult.set(null);
    this.confirmingOllamaRemove.set(false);
    void this.loadOllamaModels();
  }

  cancelOllamaEdit(): void {
    this.ollamaEditing.set(false);
    this.ollamaUrlError.set(null);
  }

  onOllamaUrlInput(event: Event): void {
    this.ollamaUrl.set((event.target as HTMLInputElement).value);
    this.ollamaUrlError.set(null);
    this.ollamaModels.set(null);
  }

  onOllamaModelSelected(event: Event): void {
    this.ollamaModel.set((event.target as HTMLSelectElement).value);
  }

  /** "Test Connection" in the Ollama form: reaches the server and lists its installed models. */
  async loadOllamaModels(): Promise<void> {
    if (this.ollamaLoading()) return;

    if (!this.validOllamaUrl()) return;

    this.ollamaLoading.set(true);
    this.ollamaResult.set(null);

    try {
      const models = await this.ai.listOllamaModels(this.ollamaUrl());
      this.ollamaModels.set(models);
      if (!models.some((m) => m.id === this.ollamaModel())) {
        this.ollamaModel.set(models[0]?.id ?? '');
      }
    } catch (err) {
      this.ollamaModels.set(null);
      this.ollamaResult.set({ kind: 'error', code: toAiErrorCode(err) });
    } finally {
      this.ollamaLoading.set(false);
    }
  }

  async saveOllama(): Promise<void> {
    if (this.ollamaBusy() || !this.validOllamaUrl()) return;

    if (!this.ollamaModel()) {
      this.ollamaUrlError.set('Choose a model first. Use Test Connection to list the models installed in Ollama.');
      return;
    }

    this.ollamaResult.set(null);
    const result = await this.ai.saveOllama(this.ollamaUrl(), this.ollamaModel());

    if (result.errorCode) {
      this.ollamaResult.set({ kind: 'error', code: result.errorCode });
      return;
    }

    this.ollamaEditing.set(false);
    this.ollamaResult.set(
      result.verified ? { kind: 'saved' } : { kind: 'saved-unverified', code: this.ollama()?.lastErrorCode },
    );
  }

  async testOllama(): Promise<void> {
    if (this.ollamaBusy()) return;
    this.ollamaResult.set(null);
    const code = await this.ai.testProvider(OLLAMA_PROVIDER);
    this.ollamaResult.set(code ? { kind: 'error', code } : { kind: 'tested' });
  }

  confirmOllamaRemove(): void {
    this.ai.removeProvider(OLLAMA_PROVIDER);
    this.confirmingOllamaRemove.set(false);
    this.ollamaResult.set(null);
    this.ollamaEditing.set(false);
    this.setModelList(OLLAMA_PROVIDER, null);
  }

  onOllamaAction(action: AiErrorAction): void {
    if (action === 'retry') {
      void (this.ollamaEditing() ? this.loadOllamaModels() : this.testOllama());
    } else {
      this.startOllamaEdit();
    }
  }

  ollamaStatusLabel(): string {
    const c = this.ollama();
    if (this.ollamaBusy()) return 'Testing…';
    return c ? STATUS_LABELS[c.status] : 'Not configured';
  }

  private validOllamaUrl(): boolean {
    if (normalizeOllamaUrl(this.ollamaUrl())) return true;

    this.ollamaUrlError.set(
      'Enter an address like http://localhost:11434. Plain http is only allowed for this device (localhost); use https for any other computer.',
    );
    return false;
  }

  private setModelList(provider: AiProviderChoice, state: ModelListState | null): void {
    this.modelLists.update((all) => {
      const next = { ...all };
      if (state) next[provider] = state;
      else delete next[provider];
      return next;
    });
  }

  /**
   * Called by the Info page when the user arrives from "Connect AI" / "Check
   * API Key": open the key form where it's needed and focus it.
   */
  focusForSetup(): void {
    const active = this.activeProvider();
    const activeConnection = active ? this.ai.connections()[active] : undefined;

    if (isAiProviderId(active) && activeConnection?.status === 'failed') {
      this.startEdit(active);
    } else if (!this.usableRows().length) {
      this.startEdit(this.rows().find((r) => !r.connection)?.info.id ?? 'openai');
    }
  }

  providerName(provider: AiProviderId): string {
    return getProviderInfo(provider).label;
  }

  private setResult(provider: AiProviderId, result: RowResult | null): void {
    this.results.update((all) => {
      const next = { ...all };
      if (result) next[provider] = result;
      else delete next[provider];
      return next;
    });
  }

  private focusKeyInput(): void {
    setTimeout(() => this.keyInputRef()?.nativeElement.focus({ preventScroll: true }));
  }
}
