/**
 * Tests for the "Let AI Fill It In" tax workflow helpers: validating the AI's
 * answer, checking its numbers against the user's text, and applying stated
 * details — while the deterministic tax engine does every calculation.
 * Run with: npm run test:ai
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MALFORMED_AI_MESSAGE,
  MISSING_SALARY,
  applyDeductionsToAnswers,
  flagUnverifiedAmounts,
  hasUsableSalaryFields,
  isConfidentLocalParse,
  matchTaxYear,
  parseExtractionResponse,
  statedAmounts,
} from '../utils/tax-extraction.util';
import { buildSalaryBreakup } from '../utils/salary-calculation.util';
import { toAnnualExtractedValues } from '../utils/salary-calculation.util';
import { calculateTax } from '../utils/tax-calculation.util';
import { AVAILABLE_TAX_YEARS, TAX_YEAR_RULES } from '../config/tax-rules.config';
import { createInitialAnswers } from '../models/tax-question.model';
import type { DocumentExtractionResult } from '../models/document-extraction.model';

const ai = (body: unknown) => JSON.stringify(body);

test('parse: a well-formed answer keeps fields, regime/year/deductions and maps plain "salary" to CTC', () => {
  const r = parseExtractionResponse(
    '```json\n' +
      ai({
        isRelevant: true,
        documentType: 'unknown',
        currency: 'INR',
        fields: [
          { rawLabel: 'Annual Salary', mappedField: null, value: 1200000, frequency: 'annual' },
          { rawLabel: 'HRA', mappedField: null, value: 200000, frequency: 'annual' },
        ],
        taxDetails: { regime: 'old', financialYear: '2025-26', deductions: { section80C: 150000, nps: null }, tdsAnnual: '45,000' },
      }) +
      '\n```',
  );

  assert.equal(r.isRelevant, true);
  assert.deepEqual(r.fields.map((f) => f.mappedField), ['annualCtc', 'hraAnnual']);
  assert.deepEqual(r.taxDetails, { regime: 'old', financialYear: '2025-26', deductions: { section80C: 150000 }, tdsAnnual: 45000 });
  assert.equal(r.missing, undefined);
  assert.equal(hasUsableSalaryFields(r), true);
});

test('parse: malformed, non-JSON or empty AI answers never produce data', () => {
  for (const raw of ['Sure! Your tax is ₹50,000.', '{not json', '[]', '']) {
    const r = parseExtractionResponse(raw);
    assert.equal(r.isRelevant, false, raw);
    assert.equal(r.fields.length, 0);
    assert.equal(r.message, MALFORMED_AI_MESSAGE);
  }
});

test('parse: invalid amounts are dropped; "relevant" with nothing usable becomes a clear "nothing found"', () => {
  const r = parseExtractionResponse(
    ai({ isRelevant: true, fields: [{ rawLabel: 'Basic', value: -5 }, { rawLabel: 'CTC', value: 'abc' }, { rawLabel: '', value: 100 }, { rawLabel: 'X', value: 1e12 }] }),
  );
  assert.equal(r.isRelevant, false);
  assert.match(r.message ?? '', /No salary or tax details were found/);
});

test('parse: deductions mapped as salary income are un-mapped (they would inflate income)', () => {
  const r = parseExtractionResponse(
    ai({ isRelevant: true, fields: [{ rawLabel: '80C investments', mappedField: 'specialAllowanceAnnual', value: 150000, frequency: 'annual' }, { rawLabel: 'Basic Salary', mappedField: 'basicAnnual', value: 600000, frequency: 'annual' }] }),
  );
  assert.deepEqual(r.fields.map((f) => f.mappedField), [undefined, 'basicAnnual']);
});

test('parse: missing salary is reported (deterministically), never filled in', () => {
  const r = parseExtractionResponse(ai({ isRelevant: true, fields: [{ rawLabel: 'HRA', mappedField: 'hraAnnual', value: 200000, frequency: 'annual' }] }));
  assert.deepEqual(r.missing, [MISSING_SALARY]);
  assert.equal(r.fields.some((f) => f.mappedField === 'annualCtc'), false);
});

test('amounts: Indian grouping and units are read exactly; section numbers are not amounts', () => {
  const amounts = statedAmounts('Salary ₹12,00,000; package 15 LPA; HRA 2 lakhs; 80C ₹1.5 lakh; bonus 50k; home loan 1 crore');
  for (const n of [1200000, 1500000, 200000, 150000, 50000, 10000000]) assert.ok(amounts.has(n), String(n));
  assert.ok(!amounts.has(80));
});

test('verify: an AI amount that does not match the typed text is flagged; unstated regime/year are dropped', () => {
  const text = 'My annual salary is ₹12,00,000. Calculate my income tax.';
  const misread: DocumentExtractionResult = {
    isRelevant: true,
    documentType: 'unknown',
    currency: 'INR',
    fields: [{ rawLabel: 'Annual Salary', mappedField: 'annualCtc', value: 12000000, frequency: 'annual' }],
    taxDetails: { regime: 'new', financialYear: '2023-24', deductions: { section80C: 99999 } },
  };

  const checked = flagUnverifiedAmounts(misread, text);
  assert.equal(checked.fields[0].unverified, true);
  assert.match(checked.message ?? '', /don't match the numbers you typed/);
  assert.deepEqual(checked.taxDetails, { deductions: {} }, 'invented regime, year and deduction removed');

  const correct = flagUnverifiedAmounts({ ...misread, fields: [{ ...misread.fields[0], value: 1200000 }] }, text);
  assert.equal(correct.fields[0].unverified, undefined);
});

test('verify: a regime the user names is kept', () => {
  const r = flagUnverifiedAmounts(
    { isRelevant: true, documentType: 'unknown', currency: 'INR', fields: [], taxDetails: { regime: 'old', deductions: {} } },
    'CTC 15 LPA under the old tax regime',
  );
  assert.equal(r.taxDetails?.regime, 'old');
});

test('local-first: only clean "Label  Amount" text skips the AI', () => {
  const clean: DocumentExtractionResult = { isRelevant: true, documentType: 'salary_breakdown', currency: 'INR', fields: [{ rawLabel: 'Basic Salary', mappedField: 'basicAnnual', value: 48000, frequency: 'monthly' }] };
  assert.equal(isConfidentLocalParse('Basic Salary  48000', clean), true);

  const prose: DocumentExtractionResult = { ...clean, fields: [{ rawLabel: 'My annual salary is', value: 1200000, frequency: 'annual' }] };
  assert.equal(isConfidentLocalParse('My annual salary is ₹12,00,000', prose), false, 'unmapped prose → AI');
  assert.equal(isConfidentLocalParse('HRA of ₹2 lakhs', { ...clean, fields: [{ rawLabel: 'HRA of', mappedField: 'hraAnnual', value: 2, frequency: 'unknown' }] }), false, 'unit words → AI');
});

test('tax year: stated FY/AY match the configured year; unknown years are not guessed', () => {
  const id = AVAILABLE_TAX_YEARS[0].id;
  assert.equal(matchTaxYear('2025-26', AVAILABLE_TAX_YEARS), id);
  assert.equal(matchTaxYear('FY 2025-2026', AVAILABLE_TAX_YEARS), id);
  assert.equal(matchTaxYear('AY 2026-27', AVAILABLE_TAX_YEARS), id);
  assert.equal(matchTaxYear('2019-20', AVAILABLE_TAX_YEARS), null);
  assert.equal(matchTaxYear('last year', AVAILABLE_TAX_YEARS), null);
});

test('deductions: fill unanswered old-regime questions only; user answers are never overwritten', () => {
  const answers = createInitialAnswers();
  answers.nps = { id: 'nps', status: 'answered_no', fields: {} };

  const { answers: next, applied } = applyDeductionsToAnswers(answers, { deductions: { section80C: 150000, nps: 50000 } });

  assert.deepEqual(applied, ['section80C']);
  assert.deepEqual(next.section80C, { id: 'section80C', status: 'answered_yes', fields: { section80CAmount: 150000 } });
  assert.equal(next.nps.status, 'answered_no');
});

test('end to end: AI-extracted values feed the existing deterministic engine (no AI arithmetic)', () => {
  const extraction = flagUnverifiedAmounts(
    parseExtractionResponse(ai({ isRelevant: true, fields: [{ rawLabel: 'Salary', mappedField: 'annualCtc', value: 1500000, frequency: 'annual' }] })),
    'I have a salary of ₹15 LPA',
  );
  const confirmed = extraction.fields.map((f) => ({ field: f.mappedField!, value: f.value, frequency: 'annual' as const, note: 'Detected and confirmed by you' }));
  const manual = { annualCtc: null, basicAnnual: null, hraAnnual: null, specialAllowanceAnnual: null, employeePfAnnual: null, professionalTaxAnnual: null, otherDeductionsAnnual: null };

  const salary = buildSalaryBreakup({ manual, extracted: toAnnualExtractedValues(confirmed) });
  assert.equal(salary.annualCtc.value, 1500000);
  assert.equal(salary.annualCtc.source, 'actual');

  const yearRules = TAX_YEAR_RULES[AVAILABLE_TAX_YEARS[0].id];
  const viaAi = calculateTax({ salary, yearRules, regimeRules: yearRules.new });
  const viaManual = calculateTax({ salary: buildSalaryBreakup({ manual: { ...manual, annualCtc: 1500000 } }), yearRules, regimeRules: yearRules.new });
  assert.equal(viaAi.tax.totalAnnualTax, viaManual.tax.totalAnnualTax, 'same engine, same answer');
  assert.ok(viaAi.tax.totalAnnualTax > 0);
});
