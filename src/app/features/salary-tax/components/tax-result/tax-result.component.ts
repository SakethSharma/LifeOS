import { Component, DestroyRef, computed, inject, input, model, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SettingsService } from '../../../../core/services/settings.service';
import { AiService } from '../../../../core/services/ai.service';
import { AiContextService } from '../../../../core/services/ai-context.service';
import type { AiErrorCode } from '../../../../core/ai/ai-contract';
import { describeAiError, isCancelled, toAiErrorCode } from '../../../../core/ai/ai-errors';
import type { AiErrorAction } from '../../../../core/ai/ai-errors';
import { AI_CONNECT_FRAGMENT, AI_SETUP_ROUTE } from '../../../../core/ai/ai-provider-guides';
import { CurrencyFormatPipe } from '../../../../shared/pipes/currency-format.pipe';
import { CollapsibleSectionComponent } from '../../../../shared/components/collapsible-section/collapsible-section.component';
import { AiStatusCardComponent } from '../../../../shared/components/ai-status-card/ai-status-card.component';
import type { RegimeComparison, TaxCalculationResult } from '../../models/tax.model';
import { toSalaryTaxFacts } from '../../utils/salary-tax-facts.util';

const EXPLAIN_PROMPT =
  'Explain my LifeOS salary and income-tax result in plain, friendly language for someone who is not a tax expert. ' +
  'Keep it under 130 words. Use only the salaryTax figures LifeOS calculated.';

@Component({
  selector: 'app-tax-result',
  standalone: true,
  imports: [CurrencyFormatPipe, CollapsibleSectionComponent, AiStatusCardComponent],
  templateUrl: './tax-result.component.html',
  styleUrl: './tax-result.component.scss',
})
export class TaxResultComponent {
  private settingsService = inject(SettingsService);
  private ai = inject(AiService);
  private aiContext = inject(AiContextService);
  private router = inject(Router);

  result = input.required<TaxCalculationResult>();
  comparison = input<RegimeComparison | null>(null);
  taxYearLabel = input<string>('');
  expanded = model<boolean>(true);

  compareRequested = output<void>();

  symbol = this.settingsService.currencySymbol;
  aiAvailable = this.ai.isConnected;
  hasAlternativeProvider = this.ai.hasAlternativeProvider;

  showBreakdown = signal(false);
  explanation = signal<string | null>(null);
  explaining = signal(false);
  explainErrorCode = signal<AiErrorCode | null>(null);

  private explainRequest: AbortController | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.explainRequest?.abort());
  }

  /** Stop: cancels the explanation request; nothing partial is shown. */
  stopExplaining(): void {
    this.explainRequest?.abort();
    this.explainRequest = null;
    this.explaining.set(false);
  }

  explainErrorView = computed(() => {
    const code = this.explainErrorCode();
    return code ? describeAiError(code) : null;
  });

  toggleBreakdown(): void {
    this.showBreakdown.update((v) => !v);
  }

  async explainWithAi(): Promise<void> {
    if (this.explaining()) {
      return;
    }

    this.explaining.set(true);
    this.explainErrorCode.set(null);
    this.explanation.set(null);
    const request = new AbortController();
    this.explainRequest = request;

    try {
      // This exact result is what AI explains, whatever else is in the shared context.
      const context = {
        ...this.aiContext.build(),
        salaryTax: {
          source: 'LifeOS salary & tax calculator (deterministic)',
          ...toSalaryTaxFacts(this.result(), this.taxYearLabel()),
        },
      };

      const text = await this.ai.chat([], EXPLAIN_PROMPT, context, [], request.signal);
      if (!request.signal.aborted) this.explanation.set(text);
    } catch (err) {
      if (!request.signal.aborted && !isCancelled(err)) this.explainErrorCode.set(toAiErrorCode(err));
    } finally {
      if (this.explainRequest === request) {
        this.explainRequest = null;
        this.explaining.set(false);
      }
    }
  }

  async onExplainErrorAction(action: AiErrorAction): Promise<void> {
    if (action === 'retry') {
      await this.explainWithAi();
    } else if (action === 'billing') {
      this.ai.openBillingPage();
    } else {
      await this.router.navigate([AI_SETUP_ROUTE], { fragment: AI_CONNECT_FRAGMENT });
    }
  }

  async connectAi(): Promise<void> {
    await this.router.navigate([AI_SETUP_ROUTE], { fragment: AI_CONNECT_FRAGMENT });
  }
}
