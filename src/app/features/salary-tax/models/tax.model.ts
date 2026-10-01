import type { TaxRegimeId } from './tax-rules.model';
import type { SalaryBreakup } from './salary.model';

export interface DeductionLine {
  label: string;
  amount: number;
  /** True when the amount is 0 because the user never answered / said no — not fabricated. */
  provided: boolean;
}

export interface TaxBreakdown {
  regime: TaxRegimeId;
  taxYearId: string;

  grossAnnualSalary: number;
  standardDeduction: number;
  deductionLines: DeductionLine[];
  totalDeductions: number;
  taxableIncome: number;

  taxBeforeRebate: number;
  rebate: number;
  taxAfterRebate: number;
  surcharge: number;
  cess: number;
  totalAnnualTax: number;
  monthlyTax: number;
}

export interface TakeHomeSummary {
  annualCtc: number;
  monthlyCtc: number;
  employeePfAnnual: number;
  employeePfMonthly: number;
  professionalTaxAnnual: number;
  professionalTaxMonthly: number;
  otherDeductionsAnnual: number;
  otherDeductionsMonthly: number;
  annualTakeHome: number;
  monthlyTakeHome: number;
}

export interface TaxCalculationResult {
  salary: SalaryBreakup;
  tax: TaxBreakdown;
  takeHome: TakeHomeSummary;
}

export interface RegimeComparison {
  new: TaxCalculationResult;
  old: TaxCalculationResult;
}
