/**
 * Framework-free helpers for the "Let AI Fill It In" tax workflow: validating
 * what the AI returns, deciding when the on-device parser is good enough, and
 * applying stated tax details to the calculator's inputs. Nothing here
 * calculates tax — the tax engine stays the only source of truth.
 */
import type {
  DocumentExtractionResult,
  ExtractedDeductionKey,
  ExtractedField,
  ExtractedTaxDetails,
  ExtractionFrequency,
} from '../models/document-extraction.model';
import type { SalaryFieldKey } from '../models/salary.model';
import type { TaxQuestionAnswer, TaxQuestionFields, TaxQuestionId } from '../models/tax-question.model';

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

export const DEDUCTION_KEYS: ExtractedDeductionKey[] = [
  'section80C',
  'section80D',
  'homeLoanInterest',
  'educationLoanInterest',
  'nps',
  'donations',
];

export const DEDUCTION_LABELS: Record<ExtractedDeductionKey, string> = {
  section80C: 'Section 80C investments',
  section80D: 'Health insurance (80D)',
  homeLoanInterest: 'Home loan interest (24b)',
  educationLoanInterest: 'Education loan interest (80E)',
  nps: 'NPS (80CCD(1B))',
  donations: 'Donations (80G)',
};

/** Word units ("15 LPA", "2 lakhs", "1 crore", "50k") the regex parser can't scale correctly. */
const AMOUNT_UNIT_PATTERN = /\d\s*(lpa|lakhs?|lacs?|crores?|cr\b|k\b|mn\b|million)/i;

export const MALFORMED_AI_MESSAGE =
  "The AI's answer couldn't be read as salary data. Please try again, or enter the values manually.";

/**
 * The on-device parser is reliable only for "Label  Amount" layouts. Prose
 * ("My annual salary is ₹12,00,000"), unit words ("15 LPA", "2 lakhs") or
 * unrecognised labels need the AI, when one is connected.
 */
export function isConfidentLocalParse(text: string, result: DocumentExtractionResult): boolean {
  return (
    result.isRelevant &&
    result.fields.length > 0 &&
    result.fields.every((f) => !!f.mappedField) &&
    !AMOUNT_UNIT_PATTERN.test(text)
  );
}

/** Validates the AI's JSON. Anything malformed becomes a clear "couldn't read" result — never invented data. */
export function parseExtractionResponse(raw: string): DocumentExtractionResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    return { isRelevant: false, documentType: 'unknown', currency: 'INR', fields: [], message: MALFORMED_AI_MESSAGE };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { isRelevant: false, documentType: 'unknown', currency: 'INR', fields: [], message: MALFORMED_AI_MESSAGE };
  }

  const obj = parsed as Record<string, unknown>;
  const documentType = KNOWN_DOCUMENT_TYPES.includes(obj['documentType'] as never)
    ? (obj['documentType'] as DocumentExtractionResult['documentType'])
    : 'unknown';

  let isRelevant = typeof obj['isRelevant'] === 'boolean' ? obj['isRelevant'] : documentType !== 'irrelevant';
  const currency = typeof obj['currency'] === 'string' && obj['currency'].trim() ? obj['currency'].trim().slice(0, 10) : 'INR';
  let message = typeof obj['message'] === 'string' && obj['message'].trim() ? obj['message'].trim().slice(0, 500) : undefined;

  const fields = inferMissingMappings(
    (Array.isArray(obj['fields']) ? obj['fields'] : [])
      .map(toExtractedField)
      .filter((f): f is ExtractedField => f !== null)
      .map(unmapDeductionsAsIncome),
  );

  const taxDetails = parseTaxDetails(obj['taxDetails']);

  // "Relevant" but nothing usable at all: say so plainly instead of an empty review.
  if (isRelevant && fields.length === 0 && !taxDetails) {
    isRelevant = false;
    message = NOTHING_FOUND_MESSAGE;
  }
  // Decided here, not by the model: small models list noise. Only the calculator's real minimum is required.
  const missing = isRelevant && !fields.some((f) => f.mappedField === 'annualCtc' || f.mappedField === 'basicAnnual')
    ? [MISSING_SALARY]
    : [];

  return {
    isRelevant,
    documentType,
    currency,
    fields,
    ...(message ? { message } : {}),
    ...(taxDetails ? { taxDetails } : {}),
    ...(missing.length ? { missing } : {}),
  };
}

export const MISSING_SALARY = 'Your annual CTC (total salary) or your basic salary';

export const NOTHING_FOUND_MESSAGE =
  'No salary or tax details were found. Describe your salary (for example "My annual CTC is ₹12,00,000") or upload a salary slip.';

/** Labels that describe a deduction, investment or tax — never part of salary income. */
const DEDUCTION_LABEL = /80c|80d|80e|80g|80ccd|invest|insurance|premium|deduction|loan|interest|\bnps\b|donation|\brent\b|\btds\b/;
const INCOME_FIELDS: SalaryFieldKey[] = ['annualCtc', 'basicAnnual', 'hraAnnual', 'specialAllowanceAnnual', 'grossAnnual'];

/** A model mapping "80C investments" to an allowance would inflate income: undo such mappings. */
function unmapDeductionsAsIncome(f: ExtractedField): ExtractedField {
  if (f.mappedField && INCOME_FIELDS.includes(f.mappedField) && DEDUCTION_LABEL.test(f.rawLabel.toLowerCase())) {
    const { mappedField: _wrong, ...rest } = f;
    return rest;
  }
  return f;
}

/** Same label keywords the on-device parser uses (most specific first). */
const LABEL_KEYWORDS: { field: SalaryFieldKey; pattern: RegExp }[] = [
  { field: 'annualCtc', pattern: /cost to company|\bctc\b/ },
  { field: 'grossAnnual', pattern: /\bgross\b/ },
  { field: 'hraAnnual', pattern: /house rent allowance|\bhra\b/ },
  { field: 'specialAllowanceAnnual', pattern: /special allowance|other allowance|special pay/ },
  { field: 'employeePfAnnual', pattern: /provident fund|\bpf\b|\bepf\b/ },
  { field: 'basicAnnual', pattern: /\bbasic\b/ },
  { field: 'professionalTaxAnnual', pattern: /prof(essional|\.)? ?tax/ },
];

/**
 * Small local models often return a clearly labelled amount without the
 * mapping. Map unambiguous labels deterministically; an overall "salary" or
 * "package" becomes the annual CTC only when it's stated per year and nothing
 * else already gives the CTC/gross. Anything unclear stays unmapped (shown as
 * "not used"), never guessed.
 */
function inferMissingMappings(fields: ExtractedField[]): ExtractedField[] {
  const used = new Set(fields.map((f) => f.mappedField).filter(Boolean));

  return fields.map((f) => {
    if (f.mappedField) return f;

    const label = f.rawLabel.toLowerCase();
    const keyword = LABEL_KEYWORDS.find((k) => k.pattern.test(label) && !used.has(k.field));

    if (keyword) {
      used.add(keyword.field);
      return { ...f, mappedField: keyword.field };
    }

    const overallSalary = /\b(salary|package|compensation|lpa)\b/.test(label) && !/\b(net|take.?home|in.?hand|monthly)\b/.test(label);
    if (overallSalary && f.frequency === 'annual' && !used.has('annualCtc') && !used.has('grossAnnual')) {
      used.add('annualCtc');
      return { ...f, mappedField: 'annualCtc' };
    }

    return f;
  });
}

/**
 * Every amount the user's text states, as plain rupees: "12,00,000" →
 * 1200000, "15 LPA" → 1500000, "2 lakhs" → 200000, "1 crore" → 10000000,
 * "50k" → 50000. Used to check the AI's numbers, not to replace them.
 */
export function statedAmounts(text: string): Set<number> {
  const amounts = new Set<number>();
  // Skip numbers that are part of a word or section name ("80C", "24b", "FY 2025-26").
  const pattern = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|l\b|crores?|cr\b|k\b)?(?![a-z\d])/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const base = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(base) || base <= 0) continue;

    const unit = (match[2] ?? '').toLowerCase();
    const scale = /^(lpa|lakhs?|lacs?|l)$/.test(unit) ? 1e5 : /^(crores?|cr)$/.test(unit) ? 1e7 : unit === 'k' ? 1e3 : 1;
    amounts.add(Math.round(base * scale));
  }

  return amounts;
}

/**
 * For typed text, flags AI amounts that don't match a number the user wrote
 * (e.g. "12,00,000" misread as 1,20,00,000). Flagged values are shown with a
 * warning so the user corrects them before anything is calculated.
 */
export function flagUnverifiedAmounts(result: DocumentExtractionResult, sourceText: string): DocumentExtractionResult {
  result = dropUnstatedRegimeAndYear(result, sourceText);
  const stated = statedAmounts(sourceText);
  if (stated.size === 0) return result;

  let flagged = 0;
  const fields = result.fields.map((f) => {
    if (stated.has(Math.round(f.value))) return f;
    flagged++;
    return { ...f, unverified: true };
  });

  // Deductions, rent and TDS are applied without a review row, so unmatched ones are left out entirely.
  let taxDetails = result.taxDetails;
  if (taxDetails) {
    const ok = (v: number | undefined) => v !== undefined && stated.has(Math.round(v));
    const deductions: ExtractedTaxDetails['deductions'] = {};
    for (const key of DEDUCTION_KEYS) {
      const amount = taxDetails.deductions[key];
      if (ok(amount)) deductions[key] = amount;
    }
    const { rentPaidAnnual, tdsAnnual, ...rest } = taxDetails;
    taxDetails = {
      ...rest,
      deductions,
      ...(ok(rentPaidAnnual) ? { rentPaidAnnual } : {}),
      ...(ok(tdsAnnual) ? { tdsAnnual } : {}),
    };
  }

  if (!flagged) return taxDetails ? { ...result, taxDetails } : result;

  const note ='Some amounts below don\'t match the numbers you typed — they\'re marked "Check". Please correct them before confirming.';
  return {
    ...result,
    fields,
    ...(taxDetails ? { taxDetails } : {}),
    message: result.message ? `${result.message} ${note}` : note,
  };
}

/** Regime and year only count when the user's text actually names them (small models fill these in). */
function dropUnstatedRegimeAndYear(result: DocumentExtractionResult, text: string): DocumentExtractionResult {
  const d = result.taxDetails;
  if (!d) return result;

  const lower = text.toLowerCase();
  const { regime, financialYear, ...rest } = d;
  const keepRegime = !!regime && new RegExp(`\\b${regime}\\s+(tax\\s+)?regime`).test(lower);
  const keepYear = !!financialYear && /\d{4}\s*[-–/]\s*\d{2,4}/.test(text);

  return {
    ...result,
    taxDetails: {
      ...rest,
      ...(keepRegime ? { regime } : {}),
      ...(keepYear ? { financialYear } : {}),
    },
  };
}

/** True when the result can be confirmed: at least one recognised salary figure. */
export function hasUsableSalaryFields(result: DocumentExtractionResult): boolean {
  return result.isRelevant && result.fields.some((f) => !!f.mappedField);
}

/** Matches a stated financial year ("2025-26", "FY 2025-2026", "AY 2026-27") to a configured tax year, or null. */
export function matchTaxYear(stated: string, years: readonly { id: string; label: string }[]): string | null {
  const text = stated.toUpperCase();
  const match = /(\d{4})\s*[-–/]\s*(\d{2,4})/.exec(text);

  if (!match) return null;

  let start = Number(match[1]);
  // An assessment year is the year after the financial year.
  if (/\bAY\b/.test(text) && !/\bFY\b/.test(text)) start -= 1;

  const fy = `FY ${start}-${String(start + 1).slice(-2)}`;
  return years.find((y) => y.label.toUpperCase().includes(fy))?.id ?? null;
}

/**
 * Fills old-regime questions from deductions the user stated. Questions the
 * user already answered are never overwritten. HRA needs details (metro city,
 * HRA received) that are confirmed in the questionnaire, so it isn't filled.
 */
export function applyDeductionsToAnswers(
  answers: Record<TaxQuestionId, TaxQuestionAnswer>,
  details: ExtractedTaxDetails,
): { answers: Record<TaxQuestionId, TaxQuestionAnswer>; applied: ExtractedDeductionKey[] } {
  const next = { ...answers };
  const applied: ExtractedDeductionKey[] = [];

  for (const key of DEDUCTION_KEYS) {
    const amount = details.deductions[key];
    const current = next[key];

    if (!amount || !current || current.status !== 'not_visited') continue;

    next[key] = { id: key, status: 'answered_yes', fields: deductionFields(key, amount) };
    applied.push(key);
  }

  return { answers: next, applied };
}

function deductionFields(key: ExtractedDeductionKey, amount: number): TaxQuestionFields {
  switch (key) {
    case 'section80C':
      return { section80CAmount: amount };
    case 'section80D':
      return { section80DSelfAmount: amount, section80DSelfSenior: false };
    case 'homeLoanInterest':
      return { homeLoanInterestAmount: amount };
    case 'educationLoanInterest':
      return { educationLoanInterestAmount: amount };
    case 'nps':
      return { npsAmount: amount };
    case 'donations':
      return { donationAmount: amount };
  }
}

function parseTaxDetails(value: unknown): ExtractedTaxDetails | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;

  const obj = value as Record<string, unknown>;
  const deductionsObj = (typeof obj['deductions'] === 'object' && obj['deductions']) || {};
  const deductions: ExtractedTaxDetails['deductions'] = {};

  for (const key of DEDUCTION_KEYS) {
    const amount = positiveAmount((deductionsObj as Record<string, unknown>)[key]);
    if (amount !== undefined) deductions[key] = amount;
  }

  const regime = obj['regime'] === 'new' || obj['regime'] === 'old' ? obj['regime'] : undefined;
  const financialYear =
    typeof obj['financialYear'] === 'string' && obj['financialYear'].trim() ? obj['financialYear'].trim().slice(0, 40) : undefined;
  const rentPaidAnnual = positiveAmount(obj['rentPaidAnnual']);
  const tdsAnnual = positiveAmount(obj['tdsAnnual']);

  const details: ExtractedTaxDetails = {
    deductions,
    ...(regime ? { regime } : {}),
    ...(financialYear ? { financialYear } : {}),
    ...(rentPaidAnnual !== undefined ? { rentPaidAnnual } : {}),
    ...(tdsAnnual !== undefined ? { tdsAnnual } : {}),
  };

  const empty = !regime && !financialYear && rentPaidAnnual === undefined && tdsAnnual === undefined && !Object.keys(deductions).length;
  return empty ? undefined : details;
}

/** A plausible rupee amount: finite, positive, below ₹100 crore. */
function positiveAmount(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e9 ? n : undefined;
}

function toExtractedField(entry: unknown): ExtractedField | null {
  if (typeof entry !== 'object' || entry === null) return null;

  const obj = entry as Record<string, unknown>;
  const value = positiveAmount(obj['value']);
  const rawLabel = typeof obj['rawLabel'] === 'string' ? obj['rawLabel'].trim().slice(0, 120) : '';

  if (!rawLabel || value === undefined) return null;

  const mappedField = KNOWN_FIELDS.includes(obj['mappedField'] as SalaryFieldKey) ? (obj['mappedField'] as SalaryFieldKey) : undefined;
  const frequency: ExtractionFrequency =
    obj['frequency'] === 'monthly' || obj['frequency'] === 'annual' ? obj['frequency'] : 'unknown';

  return { rawLabel, mappedField, value, frequency };
}

/** Strips stray prose/markdown fencing so a slightly chatty model reply still parses. */
function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in AI response.');
  }

  return text.slice(start, end + 1);
}
