/** Where a piece of salary data came from — never blur an estimate into a fact. */
export type ValueSource = 'actual' | 'estimated' | 'not_provided';

export interface SourcedValue {
  value: number;
  source: ValueSource;
  /** Human-readable provenance, e.g. "Detected from uploaded salary slip". */
  note?: string;
}

/** Raw user input for the salary calculator's manual-entry mode. */
export interface SalaryManualInput {
  annualCtc: number | null;
  basicAnnual: number | null;
  hraAnnual: number | null;
  specialAllowanceAnnual: number | null;
  employeePfAnnual: number | null;
  /** Section 16(iii) — deductible from taxable income under the Old Regime only. */
  professionalTaxAnnual: number | null;
  /** Non-tax-deductible pass-through (loan EMI via payroll, meal card, etc.) — reduces take-home only. */
  otherDeductionsAnnual: number | null;
}

/** The fully resolved salary breakup used by the tax engine, each field tagged with its source. */
export interface SalaryBreakup {
  annualCtc: SourcedValue;
  basicAnnual: SourcedValue;
  hraAnnual: SourcedValue;
  specialAllowanceAnnual: SourcedValue;
  grossAnnual: SourcedValue;
  employeePfAnnual: SourcedValue;
  professionalTaxAnnual: SourcedValue;
  otherDeductionsAnnual: SourcedValue;
}

export interface SalaryComputationInput {
  manual: SalaryManualInput;
  /** Confirmed extracted fields, applied on top of manual input where manual is empty. */
  extracted?: ExtractedFieldValue[];
}

export interface ExtractedFieldValue {
  field: SalaryFieldKey;
  annualValue: number;
  source: 'actual';
  note?: string;
}

export type SalaryFieldKey =
  | 'annualCtc'
  | 'basicAnnual'
  | 'hraAnnual'
  | 'specialAllowanceAnnual'
  | 'grossAnnual'
  | 'employeePfAnnual'
  | 'professionalTaxAnnual'
  | 'otherDeductionsAnnual';
