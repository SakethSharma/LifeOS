import { Injectable, signal, effect } from '@angular/core';
import { SettingsRepository } from '../repositories/settings.repository';
import { AppSettings, ThemeMode, SUPPORTED_CURRENCIES } from '../models/settings.model';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private repo = new SettingsRepository();
  private _settings = signal<AppSettings | null>(null);

  readonly settings = this._settings.asReadonly();
  readonly theme = signal<ThemeMode>('system');
  readonly currencySymbol = signal<string>('₹');

  async load(): Promise<void> {
    const s = await this.repo.get();
    this._settings.set(s);
    this.theme.set(s.theme);
    this.currencySymbol.set(s.currencySymbol);
  }

  get current(): AppSettings | null {
    return this._settings();
  }

  async update(partial: Partial<AppSettings>): Promise<void> {
    const updated = await this.repo.update(partial);
    this._settings.set(updated);
    this.theme.set(updated.theme);
    this.currencySymbol.set(updated.currencySymbol);
  }

  async setTheme(theme: ThemeMode): Promise<void> {
    await this.update({ theme });
  }

  async setCurrency(code: string): Promise<void> {
    const currency = SUPPORTED_CURRENCIES.find((c) => c.code === code);
    if (currency) {
      await this.update({ currency: currency.code, currencySymbol: currency.symbol });
    }
  }

  async reset(): Promise<void> {
    await this.repo.reset();
    await this.load();
  }
}
