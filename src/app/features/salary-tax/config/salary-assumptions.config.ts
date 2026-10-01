/**
 * Configurable assumptions used only when the user has not supplied an actual
 * salary breakup. Every consumer must label results derived from these as
 * "Estimated" — see ValueSource in salary.model.ts.
 */
export const SALARY_ASSUMPTIONS = {
  /** Employee (and assumed employer) Provident Fund rate, applied to Basic salary. */
  PF_RATE: 0.12,
  /** Estimated Basic salary as a fraction of annual CTC. */
  BASIC_PERCENT_OF_CTC: 0.4,
  /** Estimated HRA as a fraction of Basic (metro-city assumption). */
  HRA_PERCENT_OF_BASIC: 0.5,
} as const;

/**
 * Statutory PF wage ceiling (₹15,000/month basic) is intentionally not applied —
 * this calculator estimates PF as a flat percentage of Basic for simplicity, and
 * says so in the UI. Actual payroll PF should be uploaded/entered when known.
 */
