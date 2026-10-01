import { Injectable, inject } from '@angular/core';
import { TaxRulesService } from './tax-rules.service';
import { buildSalaryBreakup } from '../utils/salary-calculation.util';
import { calculateTax } from '../utils/tax-calculation.util';
import type { SalaryComputationInput } from '../models/salary.model';
import type { TaxQuestionAnswer, TaxQuestionId } from '../models/tax-question.model';
import type { RegimeComparison, TaxCalculationResult } from '../models/tax.model';
import type { TaxRegimeId } from '../models/tax-rules.model';

export interface RunCalculationInput {
  salaryInput: SalaryComputationInput;
  taxYearId: string;
  regime: TaxRegimeId;
  oldRegimeAnswers?: Record<TaxQuestionId, TaxQuestionAnswer>;
}

/**
 * The single entry point components use to go from raw salary input to a final
 * result. All numeric work happens in the framework-free utils; this service only
 * wires those functions to the versioned tax-year rules.
 */
@Injectable({ providedIn: 'root' })
export class TaxCalculatorService {
  private rulesService = inject(TaxRulesService);

  calculate(input: RunCalculationInput): TaxCalculationResult {
    const yearRules = this.rulesService.getRules(input.taxYearId);
    const regimeRules = input.regime === 'new' ? yearRules.new : yearRules.old;
    const salary = buildSalaryBreakup(input.salaryInput);

    return calculateTax({ salary, yearRules, regimeRules, oldRegimeAnswers: input.oldRegimeAnswers });
  }

  compareRegimes(
    input: Omit<RunCalculationInput, 'regime'>,
  ): RegimeComparison {
    return {
      new: this.calculate({ ...input, regime: 'new' }),
      old: this.calculate({ ...input, regime: 'old' }),
    };
  }
}
