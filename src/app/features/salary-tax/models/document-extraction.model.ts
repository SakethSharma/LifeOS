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
}

export type ExtractionProvider = 'local_heuristic' | 'ai';

export interface DocumentExtractionOutcome {
  result: DocumentExtractionResult;
  provider: ExtractionProvider;
}
