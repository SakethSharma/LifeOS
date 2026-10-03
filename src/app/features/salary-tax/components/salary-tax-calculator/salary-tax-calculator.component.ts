import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { SettingsService } from '../../../../core/services/settings.service';
import { AiContextService } from '../../../../core/services/ai-context.service';
import { TaxRulesService } from '../../services/tax-rules.service';
import { TaxCalculatorService } from '../../services/tax-calculator.service';
import { toAnnualExtractedValues } from '../../utils/salary-calculation.util';
import { toSalaryTaxFacts } from '../../utils/salary-tax-facts.util';
import type { ConfirmedExtractedField } from '../../utils/salary-calculation.util';
import { createInitialAnswers, hasIncompleteAnswer } from '../../models/tax-question.model';
import type { TaxQuestionAnswer, TaxQuestionId } from '../../models/tax-question.model';
import type { SalaryManualInput } from '../../models/salary.model';
import type { RegimeComparison, TaxCalculationResult } from '../../models/tax.model';
import type { TaxRegimeId } from '../../models/tax-rules.model';
import type { DocumentExtractionResult } from '../../models/document-extraction.model';

import { SalaryInputComponent } from '../salary-input/salary-input.component';
import { RegimeSelectorComponent } from '../regime-selector/regime-selector.component';
import { TaxQuestionnaireComponent } from '../tax-questionnaire/tax-questionnaire.component';
import { SalaryDocumentUploadComponent } from '../salary-document-upload/salary-document-upload.component';
import { DetectedSalaryDataComponent } from '../detected-salary-data/detected-salary-data.component';
import { SalarySummaryComponent } from '../salary-summary/salary-summary.component';
import { TaxResultComponent } from '../tax-result/tax-result.component';
import { CollapsibleSectionComponent } from '../../../../shared/components/collapsible-section/collapsible-section.component';

const INCOME_TAX_PORTAL_URL = 'https://www.incometax.gov.in/iec/foportal/';

function emptyManual(): SalaryManualInput {
  return {
    annualCtc: null,
    basicAnnual: null,
    hraAnnual: null,
    specialAllowanceAnnual: null,
    employeePfAnnual: null,
    professionalTaxAnnual: null,
    otherDeductionsAnnual: null,
  };
}

@Component({
  selector: 'app-salary-tax-calculator',
  standalone: true,
  imports: [
    SalaryInputComponent,
    RegimeSelectorComponent,
    TaxQuestionnaireComponent,
    SalaryDocumentUploadComponent,
    DetectedSalaryDataComponent,
    SalarySummaryComponent,
    TaxResultComponent,
    CollapsibleSectionComponent,
  ],
  templateUrl: './salary-tax-calculator.component.html',
  styleUrl: './salary-tax-calculator.component.scss',
})
export class SalaryTaxCalculatorComponent {
  private taxRulesService = inject(TaxRulesService);
  private taxCalculatorService = inject(TaxCalculatorService);
  private settingsService = inject(SettingsService);
  private aiContext = inject(AiContextService);

  private salaryInput = viewChild(SalaryInputComponent);
  private documentUpload = viewChild(SalaryDocumentUploadComponent);

  symbol = this.settingsService.currencySymbol;
  availableYears = this.taxRulesService.availableYears;

  expanded = signal(false);

  taxYearId = signal(this.taxRulesService.defaultYearId);
  regime = signal<TaxRegimeId>('new');

  manual = signal<SalaryManualInput>(emptyManual());
  confirmed = signal<ConfirmedExtractedField[]>([]);
  pendingDetection = signal<DocumentExtractionResult | null>(null);

  answers = signal<Record<TaxQuestionId, TaxQuestionAnswer>>(createInitialAnswers());
  activeQuestionIndex = signal(0);

  result = signal<TaxCalculationResult | null>(null);
  comparison = signal<RegimeComparison | null>(null);

  taxYearLabel = computed(
    () => this.availableYears.find((y) => y.id === this.taxYearId())?.label ?? this.taxYearId(),
  );

  /** At least a CTC or Basic Salary figure — from manual entry or a confirmed upload — is required to calculate anything. */
  hasMinimumSalaryInput = computed(() => {
    const m = this.manual();

    if ((m.annualCtc ?? 0) > 0 || (m.basicAnnual ?? 0) > 0) {
      return true;
    }

    return this.confirmed().some(
      (f) => (f.field === 'annualCtc' || f.field === 'basicAnnual') && f.value > 0,
    );
  });

  hasIncompleteOldRegimeAnswer = computed(
    () => this.regime() === 'old' && hasIncompleteAnswer(this.answers()),
  );

  canCalculate = computed(() => this.hasMinimumSalaryInput() && !this.hasIncompleteOldRegimeAnswer());

  calculateBlockedReason = computed(() => {
    if (!this.hasMinimumSalaryInput()) {
      return 'Enter at least your annual CTC or Basic Salary to calculate tax.';
    }

    if (this.hasIncompleteOldRegimeAnswer()) {
      return 'Fix the Old Regime question(s) marked ✗ (answered "Yes" but missing an amount) before calculating.';
    }

    return null;
  });

  onManualChange(partial: Partial<SalaryManualInput>): void {
    this.manual.update((m) => ({ ...m, ...partial }));
    this.clearResult();
  }

  onRegimeChange(regime: TaxRegimeId): void {
    this.regime.set(regime);
    this.clearResult();
  }

  onTaxYearChange(taxYearId: string): void {
    this.taxYearId.set(taxYearId);
    this.clearResult();
  }

  onAnswersChange(answers: Record<TaxQuestionId, TaxQuestionAnswer>): void {
    this.answers.set(answers);
    this.clearResult();
  }

  onDetected(result: DocumentExtractionResult): void {
    this.pendingDetection.set(result);
  }

  onConfirmDetected(fields: ConfirmedExtractedField[]): void {
    this.confirmed.update((existing) => {
      const byField = new Map(existing.map((f) => [f.field, f]));
      for (const f of fields) {
        byField.set(f.field, f);
      }
      return [...byField.values()];
    });
    this.pendingDetection.set(null);
    this.clearResult();
  }

  onDismissDetected(): void {
    this.pendingDetection.set(null);
  }

  calculate(): void {
    if (!this.canCalculate()) {
      return;
    }

    const result = this.taxCalculatorService.calculate({
      salaryInput: { manual: this.manual(), extracted: toAnnualExtractedValues(this.confirmed()) },
      taxYearId: this.taxYearId(),
      regime: this.regime(),
      oldRegimeAnswers: this.answers(),
    });

    this.result.set(result);
    this.comparison.set(null);
    // Lets AI Insights quote this result instead of computing its own.
    this.aiContext.salaryTax.set(toSalaryTaxFacts(result, this.taxYearLabel()));
  }

  compareRegimes(): void {
    this.comparison.set(
      this.taxCalculatorService.compareRegimes({
        salaryInput: { manual: this.manual(), extracted: toAnnualExtractedValues(this.confirmed()) },
        taxYearId: this.taxYearId(),
        oldRegimeAnswers: this.answers(),
      }),
    );
  }

  openIncomeTaxPortal(): void {
    window.open(INCOME_TAX_PORTAL_URL, '_blank', 'noopener,noreferrer');
  }

  /** From the upload card when AI can't be used: jump to the manual salary fields. */
  onEnterManually(): void {
    this.salaryInput()?.focusFirstField();
  }

  /**
   * Clears every input, upload, AI extraction, answer and result — a full
   * reset of this section. Never touches transactions or the AI connection.
   */
  resetAll(): void {
    this.salaryInput()?.resetView();
    this.documentUpload()?.reset();
    this.taxYearId.set(this.taxRulesService.defaultYearId);
    this.regime.set('new');
    this.manual.set(emptyManual());
    this.confirmed.set([]);
    this.pendingDetection.set(null);
    this.answers.set(createInitialAnswers());
    this.activeQuestionIndex.set(0);
    this.clearResult();
  }

  private clearResult(): void {
    this.result.set(null);
    this.comparison.set(null);
    this.aiContext.salaryTax.set(null);
  }
}
