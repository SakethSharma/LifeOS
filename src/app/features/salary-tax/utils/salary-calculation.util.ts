import { SALARY_ASSUMPTIONS } from '../config/salary-assumptions.config';
import type {
  ExtractedFieldValue,
  SalaryBreakup,
  SalaryComputationInput,
  SalaryFieldKey,
  SourcedValue,
} from '../models/salary.model';

function actual(value: number, note?: string): SourcedValue {
  return { value, source: 'actual', note };
}

function estimated(value: number, note?: string): SourcedValue {
  return { value, source: 'estimated', note };
}

function notProvided(): SourcedValue {
  return { value: 0, source: 'not_provided' };
}

/**
 * Merges manual input with confirmed extracted fields, then fills any still-missing
 * field with a documented estimate derived from annual CTC. Nothing here fabricates a
 * number for a field the user never supplied and cannot be estimated (e.g. other
 * deductions) — those stay `not_provided` at 0.
 */
export function buildSalaryBreakup(input: SalaryComputationInput): SalaryBreakup {
  const manualMap = manualToFieldMap(input.manual);
  const extractedMap = new Map<SalaryFieldKey, ExtractedFieldValue>(
    (input.extracted ?? []).map((f) => [f.field, f]),
  );

  const resolve = (field: SalaryFieldKey): SourcedValue | null => {
    const extractedField = extractedMap.get(field);
    if (extractedField) {
      return actual(extractedField.annualValue, extractedField.note ?? 'Detected from uploaded/pasted document');
    }
    const manualValue = manualMap[field];
    if (manualValue !== null && manualValue !== undefined) {
      return actual(manualValue, 'Entered manually');
    }
    return null;
  };

  const annualCtc = resolve('annualCtc') ?? notProvided();

  const basicAnnual =
    resolve('basicAnnual') ??
    (annualCtc.source !== 'not_provided'
      ? estimated(
          round(annualCtc.value * SALARY_ASSUMPTIONS.BASIC_PERCENT_OF_CTC),
          `Estimated as ${SALARY_ASSUMPTIONS.BASIC_PERCENT_OF_CTC * 100}% of CTC`,
        )
      : notProvided());

  const hraAnnual =
    resolve('hraAnnual') ??
    (basicAnnual.source !== 'not_provided'
      ? estimated(
          round(basicAnnual.value * SALARY_ASSUMPTIONS.HRA_PERCENT_OF_BASIC),
          `Estimated as ${SALARY_ASSUMPTIONS.HRA_PERCENT_OF_BASIC * 100}% of Basic (metro assumption)`,
        )
      : notProvided());

  const employeePfAnnual =
    resolve('employeePfAnnual') ??
    (basicAnnual.source !== 'not_provided'
      ? estimated(
          round(basicAnnual.value * SALARY_ASSUMPTIONS.PF_RATE),
          `Estimated using PF assumption (${SALARY_ASSUMPTIONS.PF_RATE * 100}% of Basic)`,
        )
      : notProvided());

  const otherDeductionsAnnual = resolve('otherDeductionsAnnual') ?? notProvided();
  const professionalTaxAnnual = resolve('professionalTaxAnnual') ?? notProvided();

  let grossAnnual = resolve('grossAnnual');
  let specialAllowanceAnnual = resolve('specialAllowanceAnnual');

  if (!grossAnnual) {
    if (annualCtc.source !== 'not_provided') {
      grossAnnual = estimated(
        round(annualCtc.value - employeePfAnnual.value),
        'Estimated as CTC minus estimated employer PF',
      );
    } else if (basicAnnual.source !== 'not_provided' && specialAllowanceAnnual) {
      grossAnnual = estimated(
        round(basicAnnual.value + hraAnnual.value + specialAllowanceAnnual.value),
        'Estimated as Basic + HRA + Special Allowance',
      );
    } else {
      grossAnnual = notProvided();
    }
  }

  if (!specialAllowanceAnnual) {
    if (grossAnnual.source !== 'not_provided' && basicAnnual.source !== 'not_provided') {
      const remainder = grossAnnual.value - basicAnnual.value - hraAnnual.value;
      specialAllowanceAnnual =
        remainder > 0
          ? estimated(round(remainder), 'Estimated as Gross minus Basic and HRA')
          : notProvided();
    } else {
      specialAllowanceAnnual = notProvided();
    }
  }

  // CTC is a distinct concept from Gross/Basic (see model docs) — if the user never
  // supplied it, it stays `not_provided` even when a breakup is known; it is never inferred.

  return {
    annualCtc,
    basicAnnual,
    hraAnnual,
    specialAllowanceAnnual,
    grossAnnual,
    employeePfAnnual,
    professionalTaxAnnual,
    otherDeductionsAnnual,
  };
}

function manualToFieldMap(manual: SalaryComputationInput['manual']): Record<SalaryFieldKey, number | null> {
  // A negative amount is not a valid salary figure; treat it as not supplied rather
  // than letting it flow into the tax engine and produce a nonsensical result.
  const clean = (v: number | null | undefined): number | null =>
    v === null || v === undefined || v < 0 || !Number.isFinite(v) ? null : v;

  return {
    annualCtc: clean(manual.annualCtc),
    basicAnnual: clean(manual.basicAnnual),
    hraAnnual: clean(manual.hraAnnual),
    specialAllowanceAnnual: clean(manual.specialAllowanceAnnual),
    grossAnnual: null,
    employeePfAnnual: clean(manual.employeePfAnnual),
    professionalTaxAnnual: clean(manual.professionalTaxAnnual),
    otherDeductionsAnnual: clean(manual.otherDeductionsAnnual),
  };
}

function round(value: number): number {
  return Math.round(value);
}

export interface ConfirmedExtractedField {
  field: SalaryFieldKey;
  value: number;
  frequency: 'monthly' | 'annual';
  note?: string;
}

/** Converts user-confirmed detected fields (each resolved to a concrete frequency) into annual values. */
export function toAnnualExtractedValues(fields: ConfirmedExtractedField[]): ExtractedFieldValue[] {
  return fields.map((f) => ({
    field: f.field,
    annualValue: f.frequency === 'monthly' ? round(f.value * 12) : round(f.value),
    source: 'actual',
    note: f.note ?? 'Detected from uploaded/pasted document',
  }));
}
