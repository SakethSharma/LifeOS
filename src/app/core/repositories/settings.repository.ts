import { db } from './database';
import { AppSettings, DEFAULT_SETTINGS } from '../models/settings.model';

export class SettingsRepository {
  async get(): Promise<AppSettings> {
    const settings = await db.settings.get('app-settings');
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
