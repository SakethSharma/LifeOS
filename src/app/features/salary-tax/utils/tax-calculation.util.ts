import type { SalaryBreakup } from '../models/salary.model';
import type { DeductionLine, TakeHomeSummary, TaxBreakdown, TaxCalculationResult } from '../models/tax.model';
import type { RebateRule, RegimeRules, SurchargeSlab, TaxSlab, TaxYearRules } from '../models/tax-rules.model';
import type { TaxQuestionAnswer, TaxQuestionId } from '../models/tax-question.model';

export interface HraExemptionInput {
  basicAnnual: number;
  hraReceivedAnnual: number;
  rentPaidAnnual: number;
  isMetro: boolean;
}

/** Section 10(13A): least of HRA received, rent paid minus 10% of Basic, and 40%/50% of Basic. */
export function calculateHraExemption(input: HraExemptionInput): number {
  const rentMinusTenPercent = Math.max(0, input.rentPaidAnnual - 0.1 * input.basicAnnual);
  const percentOfBasic = (input.isMetro ? 0.5 : 0.4) * input.basicAnnual;

  return round(Math.max(0, Math.min(input.hraReceivedAnnual, rentMinusTenPercent, percentOfBasic)));
}

export function calculateSlabTax(taxableIncome: number, slabs: TaxSlab[]): number {
  if (taxableIncome <= 0) {
    return 0;
  }

  let tax = 0;

  for (const slab of slabs) {
    if (taxableIncome <= slab.from) {
      continue;
    }

    const upper = slab.to === null ? taxableIncome : Math.min(taxableIncome, slab.to);
    const slabAmount = Math.max(0, upper - slab.from);

    tax += slabAmount * (slab.ratePercent / 100);
  }

  return round(tax);
}

export function applyRebate(taxBeforeRebate: number, taxableIncome: number, rule: RebateRule): number {
  if (taxableIncome <= rule.thresholdIncome) {
    return round(Math.min(taxBeforeRebate, rule.maxRebate));
  }

  if (rule.marginalRelief) {
    const overage = taxableIncome - rule.thresholdIncome;

    if (taxBeforeRebate > overage) {
      return round(taxBeforeRebate - overage);
    }
  }

  return 0;
}

export function applySurcharge(taxAfterRebate: number, taxableIncome: number, slabs: SurchargeSlab[]): number {
  if (taxAfterRebate <= 0) {
    return 0;
  }

  const slab = [...slabs].reverse().find((s) => taxableIncome > s.from);

  if (!slab) {
    return 0;
  }

  const rawSurcharge = taxAfterRebate * (slab.ratePercent / 100);

  // Marginal relief: tax + surcharge must not grow faster than income does past the threshold.
  const incomeOverThreshold = taxableIncome - slab.from;
  const capAtThreshold = surchargeCapBelow(taxAfterRebate, taxableIncome, slab, slabs);
  const maxTotalIncrease = incomeOverThreshold;

  if (taxAfterRebate + rawSurcharge - capAtThreshold > maxTotalIncrease) {
    return round(Math.max(0, capAtThreshold + maxTotalIncrease - taxAfterRebate));
  }

  return round(rawSurcharge);
}

function surchargeCapBelow(
  taxAfterRebate: number,
  taxableIncome: number,
  currentSlab: SurchargeSlab,
  allSlabs: SurchargeSlab[],
): number {
  // Tax + surcharge at exactly the current slab's threshold, using the rate that applied
  // just below it (0 if this is the lowest surcharge slab).
  const previousSlab = [...allSlabs].reverse().find((s) => currentSlab.from > s.from);
  const rateBelow = previousSlab ? previousSlab.ratePercent : 0;

  return taxAfterRebate * (rateBelow / 100);
}

export function calculateCess(taxAfterSurcharge: number, cessPercent: number): number {
  return round(taxAfterSurcharge * (cessPercent / 100));
}

export interface OldRegimeDeductionInput {
  basicAnnual: number;
  hraAnnual: number;
  /** Direct, non-questionnaire input from the Salary Input step (Section 16(iii)). */
  professionalTaxAnnual: { value: number; provided: boolean };
  answers: Record<TaxQuestionId, TaxQuestionAnswer>;
  rules: NonNullable<RegimeRules['deductions']>;
}

/** Builds one line per old-regime question. Unanswered/"no" questions contribute ₹0 and provided=false. */
export function calculateOldRegimeDeductions(input: OldRegimeDeductionInput): DeductionLine[] {
  const { answers, rules } = input;
  const lines: DeductionLine[] = [];

  if (input.professionalTaxAnnual.provided && input.professionalTaxAnnual.value > 0) {
    const amount = Math.min(input.professionalTaxAnnual.value, rules.professionalTaxCap);
    lines.push({ label: 'Professional Tax (Sec 16(iii))', amount: round(amount), provided: true });
  } else {
    lines.push({ label: 'Professional Tax (Sec 16(iii))', amount: 0, provided: false });
  }

  const hra = answers.hra;
  if (hra?.status === 'answered_yes') {
    const amount = calculateHraExemption({
      basicAnnual: input.basicAnnual,
      hraReceivedAnnual: hra.fields.hraReceivedAnnual ?? input.hraAnnual,
      rentPaidAnnual: hra.fields.rentPaidAnnual ?? 0,
      isMetro: hra.fields.isMetro ?? false,
    });
    lines.push({ label: 'HRA Exemption', amount, provided: true });
  } else {
    lines.push({ label: 'HRA Exemption', amount: 0, provided: false });
  }

  const c80 = answers.section80C;
  if (c80?.status === 'answered_yes') {
    const amount = Math.min(c80.fields.section80CAmount ?? 0, rules.section80CCap);
    lines.push({ label: 'Section 80C', amount: round(amount), provided: true });
  } else {
    lines.push({ label: 'Section 80C', amount: 0, provided: false });
  }

  const d80 = answers.section80D;
  if (d80?.status === 'answered_yes') {
    const selfCap = d80.fields.section80DSelfSenior
      ? rules.section80D.selfFamilyCapSenior
      : rules.section80D.selfFamilyCapNonSenior;
    const parentsCap = d80.fields.section80DParentsSenior
      ? rules.section80D.parentsCapSenior
      : rules.section80D.parentsCapNonSenior;

    const amount =
      Math.min(d80.fields.section80DSelfAmount ?? 0, selfCap) +
      Math.min(d80.fields.section80DParentsAmount ?? 0, parentsCap);

    lines.push({ label: 'Section 80D — Health Insurance', amount: round(amount), provided: true });
  } else {
    lines.push({ label: 'Section 80D — Health Insurance', amount: 0, provided: false });
  }

  const homeLoan = answers.homeLoanInterest;
  if (homeLoan?.status === 'answered_yes') {
    const amount = Math.min(homeLoan.fields.homeLoanInterestAmount ?? 0, rules.homeLoanInterestCap);
    lines.push({ label: 'Home Loan Interest (Sec 24b)', amount: round(amount), provided: true });
  } else {
    lines.push({ label: 'Home Loan Interest (Sec 24b)', amount: 0, provided: false });
  }

  const eduLoan = answers.educationLoanInterest;
  if (eduLoan?.status === 'answered_yes') {
    const amount = eduLoan.fields.educationLoanInterestAmount ?? 0;
    lines.push({ label: 'Education Loan Interest (Sec 80E)', amount: round(amount), provided: true });
  } else {
    lines.push({ label: 'Education Loan Interest (Sec 80E)', amount: 0, provided: false });
  }

  const nps = answers.nps;
  if (nps?.status === 'answered_yes') {
    const amount = Math.min(nps.fields.npsAmount ?? 0, rules.section80CCD1BCap);
    lines.push({ label: 'NPS — Section 80CCD(1B)', amount: round(amount), provided: true });
  } else {
    lines.push({ label: 'NPS — Section 80CCD(1B)', amount: 0, provided: false });
  }

  const donations = answers.donations;
  if (donations?.status === 'answered_yes') {
    const amount = (donations.fields.donationAmount ?? 0) * rules.section80GEligibleRate;
    lines.push({ label: 'Donations — Section 80G (est.)', amount: round(amount), provided: true });
  } else {
    lines.push({ label: 'Donations — Section 80G (est.)', amount: 0, provided: false });
  }

  return lines;
}

export interface CalculateTaxInput {
  salary: SalaryBreakup;
  yearRules: TaxYearRules;
  regimeRules: RegimeRules;
  oldRegimeAnswers?: Record<TaxQuestionId, TaxQuestionAnswer>;
}

export function calculateTaxBreakdown(input: CalculateTaxInput): TaxBreakdown {
  const { salary, regimeRules } = input;
  const grossAnnualSalary = Math.max(0, salary.grossAnnual.value);
  const standardDeduction = regimeRules.standardDeduction;

  const deductionLines: DeductionLine[] =
    regimeRules.regime === 'old' && regimeRules.deductions && input.oldRegimeAnswers
      ? calculateOldRegimeDeductions({
          basicAnnual: salary.basicAnnual.value,
          hraAnnual: salary.hraAnnual.value,
          professionalTaxAnnual: {
            value: salary.professionalTaxAnnual.value,
            provided: salary.professionalTaxAnnual.source === 'actual',
          },
          answers: input.oldRegimeAnswers,
          rules: regimeRules.deductions,
        })
      : [];

  const totalDeductions = round(deductionLines.reduce((sum, l) => sum + l.amount, 0));
  const taxableIncome = Math.max(0, round(grossAnnualSalary - standardDeduction - totalDeductions));

  const taxBeforeRebate = calculateSlabTax(taxableIncome, regimeRules.slabs);
  const rebate = applyRebate(taxBeforeRebate, taxableIncome, regimeRules.rebate);
  const taxAfterRebate = Math.max(0, round(taxBeforeRebate - rebate));
  const surcharge = applySurcharge(taxAfterRebate, taxableIncome, regimeRules.surcharge);
  const cess = calculateCess(taxAfterRebate + surcharge, regimeRules.cessPercent);
  const totalAnnualTax = round(taxAfterRebate + surcharge + cess);

  return {
    regime: regimeRules.regime,
    taxYearId: input.yearRules.taxYearId,
    grossAnnualSalary: round(grossAnnualSalary),
    standardDeduction,
    deductionLines,
    totalDeductions,
    taxableIncome,
    taxBeforeRebate,
    rebate,
    taxAfterRebate,
    surcharge,
    cess,
    totalAnnualTax,
    monthlyTax: round(totalAnnualTax / 12),
  };
}

export function buildTakeHomeSummary(salary: SalaryBreakup, tax: TaxBreakdown): TakeHomeSummary {
  const annualCtc = salary.annualCtc.source !== 'not_provided' ? salary.annualCtc.value : salary.grossAnnual.value;
  const employeePfAnnual = salary.employeePfAnnual.value;
  const professionalTaxAnnual = salary.professionalTaxAnnual.value;
  const otherDeductionsAnnual = salary.otherDeductionsAnnual.value;

  // Professional tax is deducted from every payslip regardless of regime, even though
  // only the Old Regime treats it as tax-deductible (see calculateOldRegimeDeductions).
  const annualTakeHome = round(
    salary.grossAnnual.value - employeePfAnnual - professionalTaxAnnual - otherDeductionsAnnual - tax.totalAnnualTax,
  );

  return {
    annualCtc: round(annualCtc),
    monthlyCtc: round(annualCtc / 12),
    employeePfAnnual: round(employeePfAnnual),
    employeePfMonthly: round(employeePfAnnual / 12),
    professionalTaxAnnual: round(professionalTaxAnnual),
    professionalTaxMonthly: round(professionalTaxAnnual / 12),
    otherDeductionsAnnual: round(otherDeductionsAnnual),
    otherDeductionsMonthly: round(otherDeductionsAnnual / 12),
    annualTakeHome,
    monthlyTakeHome: round(annualTakeHome / 12),
  };
}

export function calculateTax(input: CalculateTaxInput): TaxCalculationResult {
  const tax = calculateTaxBreakdown(input);
  const takeHome = buildTakeHomeSummary(input.salary, tax);

  return { salary: input.salary, tax, takeHome };
}

function round(value: number): number {
  return Math.round(value);
}
