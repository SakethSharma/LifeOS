import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { SettingsService } from './core/services/settings.service';
import { ThemeService } from './core/services/theme.service';
import { TransactionService } from './core/services/transaction.service';
import { BackButtonService } from './core/services/back-button.service';

@Component({
  selector: 'app-root',
  // Render routes only after settings and transactions are loaded, so a refresh
  // does not flash the empty state or read unloaded settings.
  template: `@if (ready()) {
    <router-outlet></router-outlet>
  }`,
  imports: [RouterOutlet],
})
export class App implements OnInit {
  private settings = inject(SettingsService);
  private themeService = inject(ThemeService);
  private transactionService = inject(TransactionService);
  private router = inject(Router);
  private backButton = inject(BackButtonService);

  ready = signal(false);

  async ngOnInit(): Promise<void> {
    void this.backButton.init();

    try {
      await this.settings.load();
      await this.transactionService.loadAll();
    } finally {
      this.ready.set(true);
    }
  }
}
