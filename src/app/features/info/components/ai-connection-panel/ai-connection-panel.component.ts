import { Component, ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';
import { AiService } from '../../../../core/services/ai.service';
import { AI_PROVIDERS, getProviderInfo } from '../../../../core/ai/ai-provider-guides';
import type { AiErrorCode, AiProviderId } from '../../../../core/ai/ai-contract';
import { describeAiError } from '../../../../core/ai/ai-errors';
import type { AiErrorView } from '../../../../core/ai/ai-errors';
import { AiStatusCardComponent } from '../../../../shared/components/ai-status-card/ai-status-card.component';

/**
 * Where the user connects their own AI provider. The typed key lives only in
 * this component's memory until "Test Connection"; after a successful check
 * it is cleared, and only a masked hint is ever shown again.
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

  readonly providers = AI_PROVIDERS;

  guideRequested = output<void>();
  providerChange = output<AiProviderId>();
  disconnected = output<void>();

  private keyInputRef = viewChild<ElementRef<HTMLInputElement>>('keyField');

  connection = this.ai.connection;
  status = this.ai.status;

  provider = signal<AiProviderId>(this.ai.connection()?.provider ?? 'openai');
  keyInput = signal('');
  showKey = signal(false);
  changingKey = signal(false);
  validationMessage = signal<string | null>(null);
  justConnected = signal(false);
  lastErrorCode = signal<AiErrorCode | null>(null);

  providerInfo = computed(() => getProviderInfo(this.provider()));
  connectedProviderLabel = computed(() => {
    const c = this.connection();
    return c ? getProviderInfo(c.provider).label : '';
  });

  showForm = computed(() => !this.connection() || this.changingKey());
  testing = computed(() => this.status().state === 'testing');

  pill = computed(() => {
    switch (this.status().state) {
      case 'testing':
        return { cls: 'testing', text: 'Connecting…' };
      case 'connected':
        return { cls: 'on', text: '✓ AI connected' };
      case 'error':
        return this.connection() ? { cls: 'issue', text: '⚠ AI connection issue' } : { cls: 'off', text: '● AI not connected' };
      default:
        return { cls: 'off', text: '● AI not connected' };
    }
  });

  errorView = computed<AiErrorView | null>(() => {
    const code = this.lastErrorCode();

    if (!code || this.testing()) {
      return null;
    }

    const view = describeAiError(code);

    // The panel itself is where keys get fixed, so every action here is "try again".
    if (code === 'INVALID_KEY') {
      return {
        ...view,
        title: "We couldn't connect to your AI provider",
        message: 'Please check your API key and try again.',
        action: 'retry',
        actionLabel: 'Try Again',
      };
    }

    return { ...view, action: 'retry', actionLabel: 'Try Again' };
  });

  selectProvider(id: AiProviderId): void {
    if (this.provider() === id) return;

    this.provider.set(id);
    this.keyInput.set('');
    this.validationMessage.set(null);
    this.lastErrorCode.set(null);
    this.providerChange.emit(id);
  }

  onKeyInput(event: Event): void {
    this.keyInput.set((event.target as HTMLInputElement).value);
    this.validationMessage.set(null);
    this.justConnected.set(false);
  }

  clearKey(): void {
    this.keyInput.set('');
    this.validationMessage.set(null);
    this.focusKeyInput();
  }

  toggleShowKey(): void {
    this.showKey.update((v) => !v);
  }

  async testConnection(): Promise<void> {
    if (this.testing()) return;

    this.justConnected.set(false);
    this.lastErrorCode.set(null);

    if (!this.showForm()) {
      const code = await this.ai.testConnection();
      this.lastErrorCode.set(code);
      this.justConnected.set(code === null);
      return;
    }

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

    const code = await this.ai.connect(this.provider(), key);
    this.lastErrorCode.set(code);

    if (code === null) {
      this.keyInput.set('');
      this.showKey.set(false);
      this.changingKey.set(false);
      this.justConnected.set(true);
    }
  }

  startChangeKey(): void {
    this.changingKey.set(true);
    this.justConnected.set(false);
    this.lastErrorCode.set(null);
    this.provider.set(this.connection()?.provider ?? this.provider());
    this.focusKeyInput();
  }

  cancelChangeKey(): void {
    this.changingKey.set(false);
    this.keyInput.set('');
    this.validationMessage.set(null);
    this.lastErrorCode.set(null);
  }

  disconnect(): void {
    this.ai.disconnect();
    this.changingKey.set(false);
    this.justConnected.set(false);
    this.lastErrorCode.set(null);
    this.keyInput.set('');
    this.disconnected.emit();
  }

  /** Called by the page when the user arrives here from "How to connect AI" / "Check API Key". */
  focusForSetup(openKeyForm: boolean): void {
    if (openKeyForm && this.connection()) {
      this.startChangeKey();
      return;
    }

    this.focusKeyInput();
  }

  private focusKeyInput(): void {
    setTimeout(() => this.keyInputRef()?.nativeElement.focus({ preventScroll: true }));
  }
}
