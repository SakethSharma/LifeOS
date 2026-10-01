import { db } from './database';
import { AppSettings, DEFAULT_SETTINGS } from '../models/settings.model';

/**
 * Fields an earlier development build stored in settings, including a raw AI
 * API key. AI credentials now live only in sealed form (see core/ai), so any
 * leftover copy is deleted on first read and can never reach an export.
 */
const LEGACY_AI_FIELDS = ['aiApiKey', 'aiModel'];

export class SettingsRepository {
  async get(): Promise<AppSettings> {
    const settings = await db.settings.get('app-settings');

    if (settings && LEGACY_AI_FIELDS.some((field) => field in settings)) {
      const cleaned = { ...settings } as Record<string, unknown>;
      LEGACY_AI_FIELDS.forEach((field) => delete cleaned[field]);
      await db.settings.put(cleaned as unknown as AppSettings);
      return cleaned as unknown as AppSettings;
    }

    return settings ?? DEFAULT_SETTINGS;
  }

  async save(settings: AppSettings): Promise<void> {
    await db.settings.put(settings);
  }

  async update(partial: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get();
    const updated = { ...current, ...partial };
    await db.settings.put(updated);
    return updated;
  }

  async reset(): Promise<void> {
    await db.settings.put(DEFAULT_SETTINGS);
  }
}
