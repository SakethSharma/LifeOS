import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { SettingsService } from './core/services/settings.service';
import { ThemeService } from './core/services/theme.service';
import { TransactionService } from './core/services/transaction.service';

@Component({
  selector: 'app-root',
  template: `<router-outlet></router-outlet>`,
  imports: [RouterOutlet],
})
export class App implements OnInit {
  private settings = inject(SettingsService);
  private themeService = inject(ThemeService);
  private transactionService = inject(TransactionService);
  private router = inject(Router);

  async ngOnInit(): Promise<void> {
    await this.settings.load();
    await this.transactionService.loadAll();
  }
}
