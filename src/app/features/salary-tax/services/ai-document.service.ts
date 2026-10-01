import { Injectable, inject } from '@angular/core';
import { AiService } from '../../../core/services/ai.service';
import type { AiContentBlock } from '../../../core/ai/ai-contract';
import type {
  DocumentExtractionResult,
  ExtractedField,
  ExtractionFrequency,
} from '../models/document-extraction.model';
import type { SalaryFieldKey } from '../models/salary.model';

const KNOWN_FIELDS: SalaryFieldKey[] = [
  'annualCtc',
  'basicAnnual',
  'hraAnnual',
  'specialAllowanceAnnual',
  'grossAnnual',
  'employeePfAnnual',
  'professionalTaxAnnual',
  'otherDeductionsAnnual',
];

const KNOWN_DOCUMENT_TYPES: DocumentExtractionResult['documentType'][] = [
  'salary_breakdown',
  'offer_letter',
  'salary_slip',
  'form16',
  'unknown',
  'irrelevant',
];

/**
 * AI-backed extraction for inputs the local regex parser can't handle — messy
 * prose, images, and PDFs. Uses the app-wide AI connection (one key for all AI
 * features); the extraction instructions live server-side in
 * netlify/ai/prompts.ts. Structured output only; the tax engine remains the
 * sole source of truth for every calculated number.
 */
@Injectable({ providedIn: 'root' })
export class AiDocumentService {
  private ai = inject(AiService);

  readonly isAvailable = this.ai.isConnected;
  readonly online = this.ai.online;

  async extractFromText(text: string): Promise<DocumentExtractionResult> {
    return this.extract([{ type: 'text', text }]);
  }

  async extractFromFile(base64Data: string, mediaType: string, kind: 'image' | 'document'): Promise<DocumentExtractionResult> {
    return this.extract([{ type: kind, mediaType, base64Data }]);
  }

  private async extract(blocks: AiContentBlock[]): Promise<DocumentExtractionResult> {
    const raw = await this.ai.extract('salary_document', blocks);

    return parseAndValidate(raw);
  }
}

function parseAndValidate(raw: string): DocumentExtractionResult {
  let parsed: unknown;

  try {
    const jsonText = extractJsonObject(raw);
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      isRelevant: false,
      documentType: 'unknown',
      currency: 'INR',
      fields: [],
      message: 'The AI response could not be understood as structured data. Please try again or enter values manually.',
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { isRelevant: false, documentType: 'unknown', currency: 'INR', fields: [], message: 'Unexpected AI response.' };
  }

  const obj = parsed as Record<string, unknown>;
  const documentType = KNOWN_DOCUMENT_TYPES.includes(obj['documentType'] as never)
    ? (obj['documentType'] as DocumentExtractionResult['documentType'])
    : 'unknown';

  const isRelevant = typeof obj['isRelevant'] === 'boolean' ? obj['isRelevant'] : documentType !== 'irrelevant';
  const currency = typeof obj['currency'] === 'string' && obj['currency'].trim() ? obj['currency'].trim() : 'INR';
  const message = typeof obj['message'] === 'string' && obj['message'].trim() ? obj['message'].trim() : undefined;

  const rawFields = Array.isArray(obj['fields']) ? (obj['fields'] as unknown[]) : [];
  const fields: ExtractedField[] = rawFields
    .map(toExtractedField)
    .filter((f): f is ExtractedField => f !== null);

  return { isRelevant, documentType, currency, fields, message };
}

function toExtractedField(entry: unknown): ExtractedField | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }

  const obj = entry as Record<string, unknown>;
  const value = Number(obj['value']);
  const rawLabel = typeof obj['rawLabel'] === 'string' ? obj['rawLabel'].trim() : '';

  if (!rawLabel || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const mappedFieldCandidate = obj['mappedField'];
  const mappedField = KNOWN_FIELDS.includes(mappedFieldCandidate as SalaryFieldKey)
    ? (mappedFieldCandidate as SalaryFieldKey)
    : undefined;

  const frequencyCandidate = obj['frequency'];
  const frequency: ExtractionFrequency =
    frequencyCandidate === 'monthly' || frequencyCandidate === 'annual' ? frequencyCandidate : 'unknown';

  return { rawLabel, mappedField, value, frequency };
}

/** Strips any stray prose/markdown fencing so a slightly chatty model reply still parses. */
function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in AI response.');
  }

  return text.slice(start, end + 1);
}
