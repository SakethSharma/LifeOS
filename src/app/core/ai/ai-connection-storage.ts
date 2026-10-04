import type { AiErrorCode, AiProviderChoice, AiProviderId } from './ai-contract';
import { AI_PROVIDER_IDS, OLLAMA_PROVIDER, isAiErrorCode, isAiProviderId, isValidModelId } from './ai-contract';
import { normalizeOllamaUrl } from './ollama-client';

/**
 * - connected:  the provider accepted the key (on save, on Test Connection, or on a real request).
 * - not_tested: saved, but the check couldn't finish (timeout, provider down…), so it's unverified.
 * - failed:     the provider rejected the key — it must be updated before use.
 */
export type ProviderConnectionStatus = 'connected' | 'not_tested' | 'failed';

/**
 * One provider's saved connection. There's deliberately no raw API key here:
 * `credential` is sealed by the LifeOS backend with a server-only secret,
 * bound to this provider, and only that backend can open it.
 */
export interface StoredProviderConnection {
  credential: string;
  keyHint: string;
  savedAt: string;
  status: ProviderConnectionStatus;
  checkedAt?: string;
  lastErrorCode?: AiErrorCode;
  /** Model chosen by the user; absent = the backend's default. Not sensitive. */
  model?: string;
}

/** The local Ollama server. Nothing secret: an address and a model name. */
export interface StoredOllamaConnection {
  baseUrl: string;
  model: string;
  savedAt: string;
  status: ProviderConnectionStatus;
  checkedAt?: string;
  lastErrorCode?: AiErrorCode;
}

export interface StoredAiConnections {
  /** Provider used for new AI requests. */
  active: AiProviderChoice | null;
  providers: Partial<Record<AiProviderId, StoredProviderConnection>>;
  ollama?: StoredOllamaConnection;
}

/**
 * Trade-off: this is still browser storage. Anyone with access to this
 * device's browser profile could use a sealed credential through the LifeOS
 * backend (not directly against the provider) until the user removes it or the
 * server secret is rotated. It is kept apart from app settings so it never
 * appears in data exports.
 */
export const AI_CONNECTIONS_STORAGE_KEY = 'lifeos.ai.connections.v2';
/** Single-provider format used before multi-provider support; migrated on first load. */
export const LEGACY_AI_CONNECTION_STORAGE_KEY = 'lifeos.ai.connection.v1';

const STATUSES: ProviderConnectionStatus[] = ['connected', 'not_tested', 'failed'];

export function emptyConnections(): StoredAiConnections {
  return { active: null, providers: {} };
}

export class AiConnectionStorage {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) {}

  load(): StoredAiConnections {
    try {
      const raw = this.storage?.getItem(AI_CONNECTIONS_STORAGE_KEY);

      if (raw) {
        return sanitize(JSON.parse(raw));
      }

      return this.migrateLegacy();
    } catch {
      return emptyConnections();
    }
  }

  save(connections: StoredAiConnections): boolean {
    try {
      this.storage?.setItem(AI_CONNECTIONS_STORAGE_KEY, JSON.stringify(connections));
      return !!this.storage;
    } catch {
      return false;
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(AI_CONNECTIONS_STORAGE_KEY);
      this.storage?.removeItem(LEGACY_AI_CONNECTION_STORAGE_KEY);
    } catch {
      // Storage unavailable — nothing persisted to clear.
    }
  }

  /** A v1 connection was verified when it was saved, so it migrates as connected and active. */
  private migrateLegacy(): StoredAiConnections {
    const raw = this.storage?.getItem(LEGACY_AI_CONNECTION_STORAGE_KEY);

    if (!raw) {
      return emptyConnections();
    }

    const legacy = JSON.parse(raw) as Record<string, unknown>;
    const migrated = emptyConnections();

    if (isAiProviderId(legacy['provider']) && typeof legacy['credential'] === 'string' && legacy['credential']) {
      migrated.active = legacy['provider'];
      migrated.providers[legacy['provider']] = {
        credential: legacy['credential'],
        keyHint: typeof legacy['keyHint'] === 'string' ? legacy['keyHint'] : '',
        savedAt: typeof legacy['connectedAt'] === 'string' ? legacy['connectedAt'] : '',
        status: 'connected',
      };
    }

    if (this.save(migrated)) {
      this.storage?.removeItem(LEGACY_AI_CONNECTION_STORAGE_KEY);
    }

    return migrated;
  }
}

/** Keeps only well-formed entries for known providers; anything else is dropped. */
function sanitize(value: unknown): StoredAiConnections {
  const result = emptyConnections();

  if (typeof value !== 'object' || value === null) {
    return result;
  }

  const obj = value as Record<string, unknown>;
  const providers = (typeof obj['providers'] === 'object' && obj['providers']) || {};

  for (const id of AI_PROVIDER_IDS) {
    const entry = (providers as Record<string, unknown>)[id] as Record<string, unknown> | undefined;

    if (!entry || typeof entry['credential'] !== 'string' || !entry['credential']) {
      continue;
    }

    result.providers[id] = {
      credential: entry['credential'],
      keyHint: typeof entry['keyHint'] === 'string' ? entry['keyHint'] : '',
      savedAt: typeof entry['savedAt'] === 'string' ? entry['savedAt'] : '',
      status: STATUSES.includes(entry['status'] as ProviderConnectionStatus)
        ? (entry['status'] as ProviderConnectionStatus)
        : 'not_tested',
      ...(typeof entry['checkedAt'] === 'string' ? { checkedAt: entry['checkedAt'] } : {}),
      ...(isAiErrorCode(entry['lastErrorCode']) ? { lastErrorCode: entry['lastErrorCode'] } : {}),
      ...(isValidModelId(entry['model']) ? { model: entry['model'] } : {}),
    };
  }

  const ollama = obj['ollama'] as Record<string, unknown> | undefined;
  const ollamaUrl = typeof ollama?.['baseUrl'] === 'string' ? normalizeOllamaUrl(ollama['baseUrl']) : null;

  if (ollama && ollamaUrl && typeof ollama['model'] === 'string' && ollama['model'] && ollama['model'].length <= 200) {
    result.ollama = {
      baseUrl: ollamaUrl,
      model: ollama['model'],
      savedAt: typeof ollama['savedAt'] === 'string' ? ollama['savedAt'] : '',
      status: STATUSES.includes(ollama['status'] as ProviderConnectionStatus)
        ? (ollama['status'] as ProviderConnectionStatus)
        : 'not_tested',
      ...(typeof ollama['checkedAt'] === 'string' ? { checkedAt: ollama['checkedAt'] } : {}),
      ...(isAiErrorCode(ollama['lastErrorCode']) ? { lastErrorCode: ollama['lastErrorCode'] } : {}),
    };
  }

  const active = obj['active'];
  result.active =
    (isAiProviderId(active) && result.providers[active]) || (active === OLLAMA_PROVIDER && result.ollama)
      ? (active as AiProviderChoice)
      : null;

  return result;
}
