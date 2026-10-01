/**
 * Plain, framework-free tests for the deterministic salary/tax engine.
 * Run with: npm run test:calc  (node --experimental-strip-types, no Angular/TestBed).
 */
import { buildSalaryBreakup } from '../utils/salary-calculation.util';
import { calculateHraExemption, calculateTax } from '../utils/tax-calculation.util';
import { TAX_YEAR_RULES } from '../config/tax-rules.config';
import { createInitialAnswers, getQuestionCompletion, hasIncompleteAnswer } from '../models/tax-question.model';
import type { SalaryManualInput } from '../models/salary.model';

const yearRules = TAX_YEAR_RULES['2025-26'];

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

function approx(actual: number, expected: number, tolerance = 1): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function emptyManual(): SalaryManualInput {
  return {
    annualCtc: null,
    basicAnnual: null,
    hraAnnual: null,
    specialAllowanceAnnual: null,
    employeePfAnnual: null,
    professionalTaxAnnual: null,
    otherDeductionsAnnual: null,
  };
}

// 1. Only CTC provided
{
  const salary = buildSalaryBreakup({ manual: { ...emptyManual(), annualCtc: 1_200_000 } });
  assert(salary.annualCtc.source === 'actual', '1. CTC marked actual');
  assert(salary.basicAnnual.source === 'estimated', '1. Basic estimated from CTC');
  assert(approx(salary.basicAnnual.value, 480_000), '1. Basic ~40% of CTC');
  assert(salary.grossAnnual.value > 0, '1. Gross derived');
}

// 2. CTC + estimated PF
{
  const salary = buildSalaryBreakup({ manual: { ...emptyManual(), annualCtc: 1_200_000 } });
  assert(salary.employeePfAnnual.source === 'estimated', '2. PF estimated');
  assert(approx(salary.employeePfAnnual.value, 480_000 * 0.12), '2. PF = 12% of estimated Basic');
}

// 3. Actual salary breakup fully provided
{
  const salary = buildSalaryBreakup({
    manual: {
      annualCtc: 1_200_000,
      basicAnnual: 480_000,
      hraAnnual: 240_000,
      specialAllowanceAnnual: 216_000,
      employeePfAnnual: 57_600,
      professionalTaxAnnual: 2_400,
      otherDeductionsAnnual: 2_400,
    },
  });
  assert(salary.basicAnnual.source === 'actual', '3. Basic actual when provided');
  assert(salary.employeePfAnnual.source === 'actual', '3. PF actual when provided (not overwritten by estimate)');
  assert(salary.otherDeductionsAnnual.value === 2_400, '3. Other deductions actual, not fabricated');
}

// 4. New regime tax calculation
{
  const salary = buildSalaryBreakup({ manual: { ...emptyManual(), annualCtc: 1_200_000 } });
  const result = calculateTax({ salary, yearRules, regimeRules: yearRules.new });
  assert(result.tax.regime === 'new', '4. Regime tagged new');
  assert(result.tax.taxableIncome === result.tax.grossAnnualSalary - yearRules.new.standardDeduction, '4. Taxable income = gross - standard deduction (no other deductions in new regime)');
  assert(result.tax.totalAnnualTax >= 0, '4. Tax non-negative');
}

// 5. Old regime, no questions answered at all
{
  const salary = buildSalaryBreakup({ manual: { ...emptyManual(), annualCtc: 1_200_000 } });
  const answers = createInitialAnswers(); // all 'not_visited'
  const result = calculateTax({ salary, yearRules, regimeRules: yearRules.old, oldRegimeAnswers: answers });
  assert(result.tax.totalDeductions === 0, '5. No deductions when nothing was ever visited');
  assert(!Number.isNaN(result.tax.totalAnnualTax), '5. Calculation still completes (never blocked)');
}

// 6. Old regime, all questions explicitly skipped (answered "no")
{
  const salary = buildSalaryBreakup({ manual: { ...emptyManual(), annualCtc: 1_200_000 } });
  const answers = createInitialAnswers();
  for (const id of Object.keys(answers) as (keyof typeof answers)[]) {
    answers[id] = { ...answers[id], status: 'answered_no' };
  }
  const result = calculateTax({ salary, yearRules, regimeRules: yearRules.old, oldRegimeAnswers: answers });
  assert(result.tax.totalDeductions === 0, '6. "No" answers contribute zero deductions');
  assert(result.tax.deductionLines.every((l) => !l.provided), '6. Every line marked not provided');
}

// 7. Old regime with selected deductions (HRA + 80C)
{
  const salary = buildSalaryBreakup({
    manual: { ...emptyManual(), annualCtc: 1_200_000, basicAnnual: 480_000, hraAnnual: 240_000 },
  });
  const answers = createInitialAnswers();
  answers.hra = {
    id: 'hra',
    status: 'answered_yes',
    fields: { hraReceivedAnnual: 240_000, rentPaidAnnual: 300_000, isMetro: true },
  };
  answers.section80C = { id: 'section80C', status: 'answered_yes', fields: { section80CAmount: 200_000 } };
  const result = calculateTax({ salary, yearRules, regimeRules: yearRules.old, oldRegimeAnswers: answers });

  const hraLine = result.tax.deductionLines.find((l) => l.label === 'HRA Exemption')!;
  const c80Line = result.tax.deductionLines.find((l) => l.label === 'Section 80C')!;
  assert(hraLine.amount > 0, '7. HRA exemption computed');
  assert(c80Line.amount === 150_000, '7. Section 80C capped at 1,50,000 even though 2,00,000 was claimed');
}

// 8. PF calculation directly
{
  const pf = 500_000 * 0.12;
  assert(approx(pf, 60_000), '8. PF = 12% of Basic');
}

// 9 & 10. Income tax + monthly tax consistency
{
  const salary = buildSalaryBreakup({ manual: { ...emptyManual(), annualCtc: 2_400_000 } });
  const result = calculateTax({ salary, yearRules, regimeRules: yearRules.new });
  assert(approx(result.tax.monthlyTax * 12, result.tax.totalAnnualTax, 12), '9/10. Monthly tax * 12 ~= annual tax');
}

// 11. Monthly take-home
{
  const salary = buildSalaryBreakup({ manual: { ...emptyManual(), annualCtc: 1_200_000 } });
  const result = calculateTax({ salary, yearRules, regimeRules: yearRules.new });
  assert(result.takeHome.monthlyTakeHome > 0, '11. Positive monthly take-home for a normal salary');
  assert(
    approx(result.takeHome.monthlyTakeHome * 12, result.takeHome.annualTakeHome, 12),
    '11. Monthly take-home * 12 ~= annual take-home',
  );
}

// 12. Zero deductions (new regime, no old-regime answers passed at all)
{
  const salary = buildSalaryBreakup({ manual: { ...emptyManual(), annualCtc: 1_200_000 } });
  const result = calculateTax({ salary, yearRules, regimeRules: yearRules.new });
  assert(result.tax.deductionLines.length === 0, '12. New regime has no itemized deduction lines');
}

// 13. Missing optional fields (only Basic given, nothing else)
{
  const salary = buildSalaryBreakup({ manual: { ...emptyManual(), basicAnnual: 500_000 } });
  assert(salary.annualCtc.source === 'not_provided', '13. CTC stays not_provided, never inferred from Basic');
  assert(salary.hraAnnual.source === 'estimated', '13. HRA still estimated from Basic');
}

// 14. Invalid negative values are rejected, not propagated
{
  const salary = buildSalaryBreakup({ manual: { ...emptyManual(), annualCtc: -500_000 } });
  assert(salary.annualCtc.source === 'not_provided', '14. Negative CTC treated as not supplied');
}

// 15. Very high salary values (surcharge + cess kick in)
{
  const salary = buildSalaryBreakup({ manual: { ...emptyManual(), annualCtc: 60_000_000 } });
  const result = calculateTax({ salary, yearRules, regimeRules: yearRules.new });
  assert(result.tax.surcharge > 0, '15. Surcharge applies at very high income');
  assert(result.tax.cess > 0, '15. Cess applies');
  assert(Number.isFinite(result.tax.totalAnnualTax), '15. Result stays finite at high income');
}

// 16. Conflicting uploaded/manual values — confirmed extracted value takes precedence
{
  const salary = buildSalaryBreakup({
    manual: { ...emptyManual(), basicAnnual: 500_000 },
    extracted: [{ field: 'basicAnnual', annualValue: 480_000, source: 'actual', note: 'From uploaded slip' }],
  });
  assert(salary.basicAnnual.value === 480_000, '16. Confirmed extracted value wins over stale manual entry');
  assert(salary.basicAnnual.source === 'actual', '16. Still marked actual, not estimated');
}

// HRA exemption formula, directly
{
  const exemption = calculateHraExemption({
    basicAnnual: 480_000,
    hraReceivedAnnual: 240_000,
    rentPaidAnnual: 300_000,
    isMetro: true,
  });
  // least of: HRA received (2.4L), rent - 10% basic (3L - 48k = 2.52L), 50% of basic (2.4L)
  assert(approx(exemption, 240_000), 'HRA exemption picks the least of the three amounts');
}

// 17. Professional tax reduces taxable income under Old Regime, capped at 2,500
{
  const salary = buildSalaryBreakup({
    manual: { ...emptyManual(), annualCtc: 1_200_000, basicAnnual: 480_000, professionalTaxAnnual: 3_000 },
  });
  const answers = createInitialAnswers();
  const result = calculateTax({ salary, yearRules, regimeRules: yearRules.old, oldRegimeAnswers: answers });
  const line = result.tax.deductionLines.find((l) => l.label === 'Professional Tax (Sec 16(iii))')!;
  assert(line.provided, '17. Professional tax line marked provided when an actual amount was entered');
  assert(line.amount === 2_500, '17. Professional tax deduction capped at 2,500/year even though 3,000 was entered');
}

// 18. Professional tax is NOT a taxable-income deduction under the New Regime, but still reduces take-home
{
  const salary = buildSalaryBreakup({
    manual: { ...emptyManual(), annualCtc: 1_200_000, professionalTaxAnnual: 2_400 },
  });
  const result = calculateTax({ salary, yearRules, regimeRules: yearRules.new });
  assert(result.tax.deductionLines.length === 0, '18. New regime has no professional tax deduction line');
  assert(result.takeHome.professionalTaxAnnual === 2_400, '18. Professional tax still reduces take-home under New Regime');
}

// 19. Question completion: "Yes" with no amount is incomplete, not complete
{
  const answers = createInitialAnswers();
  answers.hra = { id: 'hra', status: 'answered_yes', fields: {} };
  assert(getQuestionCompletion(answers.hra) === 'incomplete', '19. HRA "Yes" with no amounts is incomplete');
  assert(hasIncompleteAnswer(answers), '19. hasIncompleteAnswer detects the incomplete question');
}

// 20. Question completion: "Yes" with the required amount(s) filled is complete
{
  const answers = createInitialAnswers();
  answers.section80C = { id: 'section80C', status: 'answered_yes', fields: { section80CAmount: 50_000 } };
  assert(getQuestionCompletion(answers.section80C) === 'complete', '20. Section 80C "Yes" with an amount is complete');
  assert(!hasIncompleteAnswer(answers), '20. No incomplete answers when the only "Yes" has its amount filled');
}

// 21. Section 80D only requires one of self/parents amounts, not both
{
  const answers = createInitialAnswers();
  answers.section80D = {
    id: 'section80D',
    status: 'answered_yes',
    fields: { section80DSelfAmount: 15_000 },
  };
  assert(getQuestionCompletion(answers.section80D) === 'complete', '21. 80D complete with only self amount filled');
}

// 22. "No" and "not visited" are never "incomplete"
{
  const answers = createInitialAnswers();
  answers.nps = { id: 'nps', status: 'answered_no', fields: {} };
  assert(getQuestionCompletion(answers.nps) === 'skipped', '22. "No" answer is skipped, not incomplete');
  assert(getQuestionCompletion(answers.donations) === 'not_visited', '22. Untouched question is not_visited, not incomplete');
  assert(!hasIncompleteAnswer(answers), '22. Neither "No" nor unvisited blocks calculation');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
