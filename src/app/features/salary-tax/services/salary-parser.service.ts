import { Injectable } from '@angular/core';
import type {
  DocumentExtractionResult,
  ExtractedField,
  ExtractionFrequency,
} from '../models/document-extraction.model';
import type { SalaryFieldKey } from '../models/salary.model';

interface KeywordGroup {
  field: SalaryFieldKey;
  keywords: string[];
}

// Longer/more specific keywords are listed first so they win over a shorter
// substring match (e.g. "special allowance" before a lone "allowance").
const FIELD_KEYWORDS: KeywordGroup[] = [
  { field: 'annualCtc', keywords: ['cost to company', 'annual ctc', 'ctc'] },
  { field: 'grossAnnual', keywords: ['gross salary', 'gross pay', 'gross'] },
  { field: 'hraAnnual', keywords: ['house rent allowance', 'hra'] },
  { field: 'specialAllowanceAnnual', keywords: ['special allowance', 'other allowance', 'special pay'] },
  { field: 'employeePfAnnual', keywords: ['employee pf', 'employee provident fund', 'provident fund', 'pf'] },
  { field: 'basicAnnual', keywords: ['basic salary', 'basic pay', 'basic'] },
  { field: 'professionalTaxAnnual', keywords: ['professional tax', 'prof. tax', 'prof tax'] },
  { field: 'otherDeductionsAnnual', keywords: ['insurance premium', 'meal deduction', 'other deduction'] },
];

const RELEVANCE_KEYWORDS = [
  'salary',
  'ctc',
  'basic',
  'hra',
  'gross',
  'net pay',
  'take home',
  'provident fund',
  ' pf ',
  'form 16',
  'payslip',
  'pay slip',
  'offer letter',
  'income tax',
  'deduction',
];

// "Label" then a number, tolerating a currency symbol/colon/dash between them.
// Non-greedy label matching stops at the first number it can reach.
const LABEL_VALUE_PATTERN = /([A-Za-z][A-Za-z .()/]*?)[\s:\-]{1,3}[₹$]?\s*([\d,]+(?:\.\d+)?)/g;

@Injectable({ providedIn: 'root' })
export class SalaryParserService {
  /**
   * Deterministic, non-AI extraction for plain-text/CSV/TSV paste and uploads.
   * Works without any API key — this is the "always available" path; images and
   * PDFs require the AI document service instead, since there's no text to regex.
   */
  parseText(rawText: string): DocumentExtractionResult {
    const text = rawText.trim();

    if (!text) {
      return { isRelevant: false, documentType: 'unknown', currency: 'INR', fields: [], message: 'No text provided.' };
    }

    const lower = text.toLowerCase();
    const isRelevant = RELEVANCE_KEYWORDS.some((k) => lower.includes(k));

    if (!isRelevant) {
      return {
        isRelevant: false,
        documentType: 'irrelevant',
        currency: 'INR',
        fields: [],
        message:
          'This doesn\'t appear to be a relevant salary or tax document. Please paste a salary slip, offer letter, salary breakup, or Form 16 content.',
      };
    }

    const fields: ExtractedField[] = [];
    let match: RegExpExecArray | null;
    const pattern = new RegExp(LABEL_VALUE_PATTERN);

    while ((match = pattern.exec(text)) !== null) {
      const rawLabel = match[1].trim().replace(/\s{2,}/g, ' ');
      const value = Number(match[2].replace(/,/g, ''));

      if (!rawLabel || !Number.isFinite(value) || value <= 0) {
        continue;
      }

      const context = text.slice(Math.max(0, match.index - 10), match.index + match[0].length + 15).toLowerCase();

      fields.push({
        rawLabel,
        mappedField: mapLabel(rawLabel),
        value,
        frequency: detectFrequency(context),
      });
    }

    const currency = text.includes('₹') || lower.includes('inr') || lower.includes('rupee') ? 'INR' : 'INR';

    return {
      isRelevant: true,
      documentType: fields.some((f) => f.mappedField) ? 'salary_breakdown' : 'unknown',
      currency,
      fields,
      message:
        fields.length === 0
          ? 'Some salary-related wording was found, but no clear label/amount pairs could be extracted. Try pasting the values in a "Label  Amount" layout, one per line.'
          : undefined,
    };
  }
}

function mapLabel(rawLabel: string): SalaryFieldKey | undefined {
  const lower = rawLabel.toLowerCase();

  for (const group of FIELD_KEYWORDS) {
    if (group.keywords.some((k) => lower.includes(k))) {
      return group.field;
    }
  }

  return undefined;
}

function detectFrequency(context: string): ExtractionFrequency {
  if (/month|\/mo\b|p\.?m\.?\b/.test(context)) {
    return 'monthly';
  }

  if (/annum|annual|yearly|\/yr\b|p\.?a\.?\b/.test(context)) {
    return 'annual';
  }

  return 'unknown';
}
