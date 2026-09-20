export interface EmiResult {
  /** Fixed monthly instalment (principal + interest). */
  emi: number;
  totalPayment: number;
  totalInterest: number;
  months: number;
  /** Interest part of the first EMI. */
  firstMonthInterest: number;
  /** Principal part of the first EMI. */
  firstMonthPrincipal: number;
  /** Interest-only option: pay this every month, principal stays due until the end. */
  interestOnlyMonthly: number;
  /** Total interest paid over the whole term under the interest-only option. */
  interestOnlyTotalInterest: number;
}

/**
 * Reducing-balance EMI: P * r * (1+r)^n / ((1+r)^n - 1),
 * where r is the monthly rate and n the number of monthly instalments.
 */
export function calculateEmi(
  principal: number,
  annualRatePercent: number,
  months: number,
): EmiResult {
  const monthlyRate = annualRatePercent / 12 / 100;

  const emi =
    monthlyRate === 0
      ? principal / months
      : (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) /
        (Math.pow(1 + monthlyRate, months) - 1);

  const totalPayment = emi * months;
  const firstMonthInterest = principal * monthlyRate;
  const interestOnlyMonthly = principal * monthlyRate;

  return {
    emi,
    totalPayment,
    totalInterest: totalPayment - principal,
    months,
    firstMonthInterest,
    firstMonthPrincipal: emi - firstMonthInterest,
    interestOnlyMonthly,
    interestOnlyTotalInterest: interestOnlyMonthly * months,
  };
}
