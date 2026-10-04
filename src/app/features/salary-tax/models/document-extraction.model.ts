import type { SalaryFieldKey } from './salary.model';

export type DocumentSourceType = 'text' | 'csv' | 'image' | 'pdf';

export type ExtractionFrequency = 'monthly' | 'annual' | 'unknown';

export interface ExtractedField {
  /** Label exactly as found in the source, e.g. "Basic Salary". */
  rawLabel: string;
  /** Best-effort mapping to a known salary field; undefined when unrecognized. */
  mappedField?: SalaryFieldKey;
  value: number;
  frequency: ExtractionFrequency;
  /** True when the AI's amount doesn't match any number in the user's own text — must be checked. */
  unverified?: boolean;
}

/** Old-regime deductions the AI may find; keys match the questionnaire. */
export type ExtractedDeductionKey =
  | 'section80C'
  | 'section80D'
  | 'homeLoanInterest'
  | 'educationLoanInterest'
  | 'nps'
  | 'donations';

/** Tax-relevant details stated in the input. Every value is optional: nothing is assumed. */
export interface ExtractedTaxDetails {
  regime?: 'new' | 'old';
  financialYear?: string;
  deductions: Partial<Record<ExtractedDeductionKey, number>>;
  rentPaidAnnual?: number;
  tdsAnnual?: number;
}

export interface DocumentExtractionResult {
  isRelevant: boolean;
  documentType:
    | 'salary_breakdown'
    | 'offer_letter'
    | 'salary_slip'
    | 'form16'
    | 'unknown'
    | 'irrelevant';
  currency: string;
  fields: ExtractedField[];
  /** Set when isRelevant is false, or extraction failed/was partial. */
  message?: string;
  /** Regime, year, deductions, rent and TDS, when stated. */
  taxDetails?: ExtractedTaxDetails;
  /** Details the AI says are needed but weren't given, in plain words. */
  missing?: string[];
  /** Who read the input, e.g. "Ollama · llama3.2:latest" or "LifeOS on this device". */
  extractedBy?: string;
}

export type ExtractionProvider = 'local_heuristic' | 'ai';

export interface DocumentExtractionOutcome {
  result: DocumentExtractionResult;
  provider: ExtractionProvider;
}
