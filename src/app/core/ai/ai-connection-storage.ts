import type { AiProviderId } from './ai-contract';
import { isAiProviderId } from './ai-contract';

/**
 * What LifeOS keeps on the device about an AI connection. There's deliberately
 * no raw API key here: `credential` is sealed by the LifeOS backend with a
 * server-only secret and only that backend can open it.
 *
 * Trade-off: this is still browser storage. Anyone with access to this
 * device's browser profile could use the sealed credential through the LifeOS
 * backend (not directly against the provider) until the user disconnects or
 * the server secret is rotated. It is kept apart from app settings so it never
 * appears in data exports.
 */
export interface StoredAiConnection {
  provider: AiProviderId;
  credential: string;
  keyHint: string;
  connectedAt: string;
}

export const AI_CONNECTION_STORAGE_KEY = 'lifeos.ai.connection.v1';

export class AiConnectionStorage {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) {}

  load(): StoredAiConnection | null {
    try {
      const raw = this.storage?.getItem(AI_CONNECTION_STORAGE_KEY);

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<StoredAiConnection>;

      if (
        !isAiProviderId(parsed.provider) ||
        typeof parsed.credential !== 'string' ||
        !parsed.credential ||
        typeof parsed.keyHint !== 'string'
      ) {
        return null;
      }

      return {
        provider: parsed.provider,
        credential: parsed.credential,
        keyHint: parsed.keyHint,
        connectedAt: typeof parsed.connectedAt === 'string' ? parsed.connectedAt : '',
      };
    } catch {
      return null;
    }
  }

  save(connection: StoredAiConnection): boolean {
    try {
      this.storage?.setItem(AI_CONNECTION_STORAGE_KEY, JSON.stringify(connection));
      return !!this.storage;
    } catch {
      return false;
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(AI_CONNECTION_STORAGE_KEY);
    } catch {
      // Storage unavailable — nothing persisted to clear.
    }
  }
}
