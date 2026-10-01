import type { TaxYearRules } from '../models/tax-rules.model';

const SURCHARGE_NEW = [
  { from: 5_000_000, to: 10_000_000, ratePercent: 10 },
  { from: 10_000_000, to: 20_000_000, ratePercent: 15 },
  { from: 20_000_000, to: null, ratePercent: 25 },
];

const SURCHARGE_OLD = [
  { from: 5_000_000, to: 10_000_000, ratePercent: 10 },
  { from: 10_000_000, to: 20_000_000, ratePercent: 15 },
  { from: 20_000_000, to: 50_000_000, ratePercent: 25 },
  { from: 50_000_000, to: null, ratePercent: 37 },
];

/**
 * FY 2025-26 (AY 2026-27) rules — the most recent notified slabs at the time of
 * writing. Add further entries here (e.g. "2026-27") as new years are notified;
 * nothing outside this file needs to change.
 */
const FY_2025_26: TaxYearRules = {
  taxYearId: '2025-26',
  label: 'FY 2025-26 (AY 2026-27)',
  new: {
    regime: 'new',
    label: 'New Regime',
    standardDeduction: 75_000,
    slabs: [
      { from: 0, to: 400_000, ratePercent: 0 },
      { from: 400_000, to: 800_000, ratePercent: 5 },
      { from: 800_000, to: 1_200_000, ratePercent: 10 },
      { from: 1_200_000, to: 1_600_000, ratePercent: 15 },
      { from: 1_600_000, to: 2_000_000, ratePercent: 20 },
      { from: 2_000_000, to: 2_400_000, ratePercent: 25 },
      { from: 2_400_000, to: null, ratePercent: 30 },
    ],
    rebate: { thresholdIncome: 1_200_000, maxRebate: 60_000, marginalRelief: true },
    surcharge: SURCHARGE_NEW,
    cessPercent: 4,
  },
  old: {
    regime: 'old',
    label: 'Old Regime',
    standardDeduction: 50_000,
    slabs: [
      { from: 0, to: 250_000, ratePercent: 0 },
      { from: 250_000, to: 500_000, ratePercent: 5 },
      { from: 500_000, to: 1_000_000, ratePercent: 20 },
      { from: 1_000_000, to: null, ratePercent: 30 },
    ],
    rebate: { thresholdIncome: 500_000, maxRebate: 12_500, marginalRelief: false },
    surcharge: SURCHARGE_OLD,
    cessPercent: 4,
    deductions: {
      section80CCap: 150_000,
      section80CCD1BCap: 50_000,
      homeLoanInterestCap: 200_000,
      section80D: {
        selfFamilyCapNonSenior: 25_000,
        selfFamilyCapSenior: 50_000,
        parentsCapNonSenior: 25_000,
        parentsCapSenior: 50_000,
      },
      section80GEligibleRate: 0.5,
      standardDeduction: 50_000,
      hraMetroPercentOfBasic: 0.5,
      hraNonMetroPercentOfBasic: 0.4,
      professionalTaxCap: 2_500,
    },
  },
};

export const TAX_YEAR_RULES: Record<string, TaxYearRules> = {
  '2025-26': FY_2025_26,
};

export const DEFAULT_TAX_YEAR_ID = '2025-26';

export const AVAILABLE_TAX_YEARS = Object.values(TAX_YEAR_RULES).map((y) => ({
  id: y.taxYearId,
  label: y.label,
}));
