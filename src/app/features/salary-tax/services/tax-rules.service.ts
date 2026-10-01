import { Injectable } from '@angular/core';
import { AVAILABLE_TAX_YEARS, DEFAULT_TAX_YEAR_ID, TAX_YEAR_RULES } from '../config/tax-rules.config';
import type { TaxYearRules } from '../models/tax-rules.model';

/** Isolates every tax-year lookup so a new year's rules can be added in one config file. */
@Injectable({ providedIn: 'root' })
export class TaxRulesService {
  readonly availableYears = AVAILABLE_TAX_YEARS;
  readonly defaultYearId = DEFAULT_TAX_YEAR_ID;

  getRules(yearId: string): TaxYearRules {
    const rules = TAX_YEAR_RULES[yearId];

    if (!rules) {
      throw new Error(`No tax rules configured for year "${yearId}".`);
    }

    return rules;
  }
}
