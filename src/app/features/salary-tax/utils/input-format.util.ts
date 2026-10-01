const MAX_AMOUNT_DIGITS = 11;

/** Digits-only parse for a rupee amount input, mirroring the EMI calculator's input handling. */
export function parseAmountInput(rawValue: string): number | null {
  const digits = rawValue.replace(/\D/g, '').slice(0, MAX_AMOUNT_DIGITS);
  return digits ? Number(digits) : null;
}

export function formatAmountDisplay(value: number | null): string {
  return value === null ? '' : value.toLocaleString('en-IN');
}
