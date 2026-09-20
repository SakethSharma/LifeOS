const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function belowHundred(n: number): string {
  if (n < 20) {
    return ONES[n];
  }

  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;

  return [hundreds ? `${ONES[hundreds]} Hundred` : "", belowHundred(rest)]
    .filter(Boolean)
    .join(" ");
}

// Indian numbering: crore (1,00,00,000), lakh (1,00,000), thousand.
function numberToWords(n: number): string {
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1_000);
  const rest = n % 1_000;

  return [
    crore ? `${numberToWords(crore)} Crore` : "",
    lakh ? `${belowHundred(lakh)} Lakh` : "",
    thousand ? `${belowHundred(thousand)} Thousand` : "",
    rest ? belowThousand(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** e.g. 1250000 -> "Twelve Lakh Fifty Thousand Rupees Only". Empty for zero/invalid. */
export function amountToIndianWords(amount: number): string {
  const whole = Math.floor(amount);

  if (!Number.isFinite(whole) || whole <= 0) {
    return "";
  }

  return `${numberToWords(whole)} Rupees Only`;
}
