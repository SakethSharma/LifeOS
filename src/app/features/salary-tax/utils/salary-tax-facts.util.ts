import type { SalaryTaxFacts } from '../../../core/ai/financial-context.builder';
import type { TaxCalculationResult } from '../models/tax.model';

/** The numbers AI may quote about a salary/tax result — all produced by the LifeOS engine. */
export function toSalaryTaxFacts(result: TaxCalculationResult, taxYearLabel: string): SalaryTaxFacts {
  return {
    taxYear: taxYearLabel,
    regime: result.tax.regime,
    annualCtc: result.takeHome.annualCtc,
    grossAnnualSalary: result.tax.grossAnnualSalary,
    standardDeduction: result.tax.standardDeduction,
    totalOtherDeductions: result.tax.totalDeductions,
    taxableIncome: result.tax.taxableIncome,
    annualIncomeTax: result.tax.totalAnnualTax,
    monthlyIncomeTax: result.tax.monthlyTax,
    employeePfAnnual: result.takeHome.employeePfAnnual,
    monthlyTakeHome: result.takeHome.monthlyTakeHome,
    annualTakeHome: result.takeHome.annualTakeHome,
  };
}
