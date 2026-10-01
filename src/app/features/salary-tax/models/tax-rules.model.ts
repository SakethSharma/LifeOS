export type TaxRegimeId = 'new' | 'old';

export interface TaxSlab {
  /** Slab starts just above this amount (0 for the first slab). */
  from: number;
  /** Exclusive upper bound; null means "and above". */
  to: number | null;
  ratePercent: number;
}

export interface SurchargeSlab {
  from: number;
  to: number | null;
  ratePercent: number;
}

export interface RebateRule {
  /** Taxable income at/below this qualifies for the rebate. */
  thresholdIncome: number;
  maxRebate: number;
  /** Whether relief is given so tax never exceeds income-over-threshold near the cliff. */
  marginalRelief: boolean;
}

export interface Section80DRule {
  selfFamilyCapNonSenior: number;
  selfFamilyCapSenior: number;
  parentsCapNonSenior: number;
  parentsCapSenior: number;
}

export interface OldRegimeDeductionRules {
  section80CCap: number;
  section80CCD1BCap: number;
  homeLoanInterestCap: number;
  section80D: Section80DRule;
  /** Simplified flat eligibility rate applied to donation amounts (actual law varies 50%/100%). */
  section80GEligibleRate: number;
  standardDeduction: number;
  hraMetroPercentOfBasic: number;
  hraNonMetroPercentOfBasic: number;
  /** Section 16(iii) — most states cap professional tax deduction around this amount/year. */
  professionalTaxCap: number;
}

export interface RegimeRules {
  regime: TaxRegimeId;
  label: string;
  standardDeduction: number;
  slabs: TaxSlab[];
  rebate: RebateRule;
  surcharge: SurchargeSlab[];
  cessPercent: number;
  /** Old-regime-only deduction rules; undefined for the new regime. */
  deductions?: OldRegimeDeductionRules;
}

export interface TaxYearRules {
  taxYearId: string;
  label: string;
  new: RegimeRules;
  old: RegimeRules;
}
