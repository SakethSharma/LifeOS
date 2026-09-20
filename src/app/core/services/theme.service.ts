import { Injectable, signal, effect, Inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { SettingsService } from './settings.service';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private darkMedia: MediaQueryList;
  private _isDark = signal<boolean>(false);
  readonly isDark = this._isDark.asReadonly();

  constructor(
    private settings: SettingsService,
    @Inject(DOCUMENT) private document: Document
  ) {
    this.darkMedia = this.document.defaultView!.matchMedia('(prefers-color-scheme: dark)');

    effect(() => {
      const theme = this.settings.theme();
      this.applyTheme(theme);
    });

    this.darkMedia.addEventListener('change', () => {
      if (this.settings.theme() === 'system') {
        this.applyTheme('system');
      }
    });
  }

  private applyTheme(theme: string): void {
    const isDark = theme === 'dark' || (theme === 'system' && this.darkMedia.matches);
    this._isDark.set(isDark);
    this.document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }
}
