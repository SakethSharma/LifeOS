import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import type { AiChatTurn, AiContentBlock, AiErrorCode, AiExtractTask, AiFinancialContext, AiProviderId } from '../ai/ai-contract';
import { AiBackendClient } from '../ai/ai-backend-client';
import { AI_BACKEND_NATIVE_BASE_URL } from '../ai/ai-backend.config';
import { AiConnectionStorage } from '../ai/ai-connection-storage';
import type { StoredAiConnection } from '../ai/ai-connection-storage';
import { AiRequestError, toAiErrorCode } from '../ai/ai-errors';

export type AiConnectionState = 'not_configured' | 'testing' | 'connected' | 'error';

export interface AiConnectionStatus {
  state: AiConnectionState;
  errorCode?: AiErrorCode;
}

/**
 * The single AI entry point for the whole app — AI Insights and the salary
 * document reader share this one connection. Components never see provider
 * details, endpoints, or credentials; they get text back or an AiRequestError.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly storage = new AiConnectionStorage(safeLocalStorage());
  private readonly client = new AiBackendClient({
    baseUrl: resolveBackendBaseUrl(),
    fetch: (input, init) => fetch(input, init),
    isOnline: () => isNavigatorOnline(),
  });

  private readonly connectionSignal = signal<StoredAiConnection | null>(this.storage.load());
  private readonly statusSignal = signal<AiConnectionStatus>({
    state: this.connectionSignal() ? 'connected' : 'not_configured',
  });

  /** Masked, display-safe view of the saved connection. */
  readonly connection = computed(() => {
    const c = this.connectionSignal();
    return c ? { provider: c.provider, keyHint: c.keyHint, connectedAt: c.connectedAt } : null;
  });
  readonly isConnected = computed(() => this.connectionSignal() !== null);
  readonly status = this.statusSignal.asReadonly();
  readonly online = signal(isNavigatorOnline());

  constructor() {
    if (typeof window === 'undefined') return;

    const update = () => this.online.set(isNavigatorOnline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  }

  /** Verifies the key with the provider (via the backend) and saves only the sealed credential. */
  async connect(provider: AiProviderId, apiKey: string): Promise<AiErrorCode | null> {
    if (!apiKey.trim()) {
      return 'NOT_CONFIGURED';
    }

    this.statusSignal.set({ state: 'testing' });

    try {
      const result = await this.client.connect({ provider, apiKey: apiKey.trim() });
      const connection: StoredAiConnection = {
        provider: result.provider,
        credential: result.credential,
        keyHint: result.keyHint,
        connectedAt: new Date().toISOString(),
      };

      this.storage.save(connection);
      this.connectionSignal.set(connection);
      this.statusSignal.set({ state: 'connected' });
      return null;
    } catch (err) {
      const code = toAiErrorCode(err);
      this.statusSignal.set({ state: 'error', errorCode: code });
      return code;
    }
  }

  /** Re-checks the saved connection with a real provider call. */
  async testConnection(): Promise<AiErrorCode | null> {
    const connection = this.connectionSignal();

    if (!connection) {
      this.statusSignal.set({ state: 'not_configured' });
      return 'NOT_CONFIGURED';
    }

    this.statusSignal.set({ state: 'testing' });

    try {
      await this.client.test(connection.provider, connection.credential);
      this.statusSignal.set({ state: 'connected' });
      return null;
    } catch (err) {
      const code = toAiErrorCode(err);
      this.statusSignal.set({ state: 'error', errorCode: code });
      return code;
    }
  }

  /** Forgets the connection. Never touches transactions, salary data, or settings. */
  disconnect(): void {
    this.storage.clear();
    this.connectionSignal.set(null);
    this.statusSignal.set({ state: 'not_configured' });
  }

  async chat(history: AiChatTurn[], message: string, context: AiFinancialContext | null): Promise<string> {
    const connection = this.requireConnection();

    return this.track(() =>
      this.client.chat({ provider: connection.provider, history, message, context }, connection.credential),
    );
  }

  async extract(task: AiExtractTask, blocks: AiContentBlock[]): Promise<string> {
    const connection = this.requireConnection();

    return this.track(() =>
      this.client.extract({ provider: connection.provider, task, blocks }, connection.credential),
    );
  }

  private requireConnection(): StoredAiConnection {
    const connection = this.connectionSignal();

    if (!connection) {
      throw new AiRequestError('NOT_CONFIGURED');
    }

    return connection;
  }

  /** Surfaces a rejected key on the connection status, so the settings panel reflects it too. */
  private async track<T>(run: () => Promise<T>): Promise<T> {
    try {
      const result = await run();
      if (this.statusSignal().state === 'error') {
        this.statusSignal.set({ state: 'connected' });
      }
      return result;
    } catch (err) {
      if (toAiErrorCode(err) === 'INVALID_KEY') {
        this.statusSignal.set({ state: 'error', errorCode: 'INVALID_KEY' });
      }
      throw err;
    }
  }
}

function resolveBackendBaseUrl(): string | null {
  if (!Capacitor.isNativePlatform()) {
    return '';
  }

  return AI_BACKEND_NATIVE_BASE_URL.trim() ? AI_BACKEND_NATIVE_BASE_URL.trim().replace(/\/+$/, '') : null;
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
