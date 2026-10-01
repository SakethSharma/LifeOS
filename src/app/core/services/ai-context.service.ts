import { Injectable, inject, signal } from '@angular/core';
import type { AiFinancialContext } from '../ai/ai-contract';
import { buildFinancialContext } from '../ai/financial-context.builder';
import type { SalaryTaxFacts } from '../ai/financial-context.builder';
import { SettingsService } from './settings.service';
import { TransactionService } from './transaction.service';

/**
 * Collects the LifeOS facts an AI request may use. Features publish their
 * deterministic results here (e.g. the salary & tax calculator) so AI answers
 * quote LifeOS's numbers instead of producing their own.
 */
@Injectable({ providedIn: 'root' })
export class AiContextService {
  private transactionService = inject(TransactionService);
  private settingsService = inject(SettingsService);

  /** Latest salary & tax calculation this session; cleared when the calculator is reset. */
  readonly salaryTax = signal<SalaryTaxFacts | null>(null);

  build(): AiFinancialContext {
    const settings = this.settingsService.current;

    return buildFinancialContext({
      transactions: this.transactionService.transactions(),
      currencyCode: settings?.currency ?? 'INR',
      currencySymbol: this.settingsService.currencySymbol(),
      now: new Date(),
      salaryTax: this.salaryTax(),
    });
  }
}
