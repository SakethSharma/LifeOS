export type TaxQuestionId =
  | 'hra'
  | 'section80C'
  | 'section80D'
  | 'homeLoanInterest'
  | 'educationLoanInterest'
  | 'nps'
  | 'donations';

export type QuestionStatus =
  | 'not_visited'
  | 'answered_yes'
  | 'answered_no'
  | 'skipped';

export interface TaxQuestionMeta {
  id: TaxQuestionId;
  order: number;
  title: string;
  prompt: string;
}

export const OLD_REGIME_QUESTIONS: TaxQuestionMeta[] = [
  {
    id: 'hra',
    order: 1,
    title: 'HRA Exemption',
    prompt: 'Do you claim House Rent Allowance (HRA) exemption?',
  },
  {
    id: 'section80C',
    order: 2,
    title: 'Section 80C Investments',
    prompt: 'Do you have Section 80C investments (PF, ELSS, LIC, PPF, etc.)?',
  },
  {
    id: 'section80D',
    order: 3,
    title: 'Section 80D — Health Insurance',
    prompt: 'Do you pay health insurance premiums?',
  },
  {
    id: 'homeLoanInterest',
    order: 4,
    title: 'Home Loan Interest',
    prompt: 'Do you pay interest on a home loan (Section 24b)?',
  },
  {
    id: 'educationLoanInterest',
    order: 5,
    title: 'Education Loan Interest',
    prompt: 'Do you pay interest on an education loan (Section 80E)?',
  },
  {
    id: 'nps',
    order: 6,
    title: 'NPS Contribution',
    prompt: 'Do you contribute to NPS under Section 80CCD(1B)?',
  },
  {
    id: 'donations',
    order: 7,
    title: 'Donations',
    prompt: 'Have you made donations eligible under Section 80G?',
  },
];

/** Per-question fields; all optional because a "yes" only requires the fields relevant to that question. */
export interface TaxQuestionFields {
  hraReceivedAnnual?: number | null;
  rentPaidAnnual?: number | null;
  isMetro?: boolean;

  section80CAmount?: number | null;

  section80DSelfAmount?: number | null;
  section80DSelfSenior?: boolean;
  section80DParentsAmount?: number | null;
  section80DParentsSenior?: boolean;

  homeLoanInterestAmount?: number | null;

  educationLoanInterestAmount?: number | null;

  npsAmount?: number | null;

  donationAmount?: number | null;
}

export interface TaxQuestionAnswer {
  id: TaxQuestionId;
  status: QuestionStatus;
  fields: TaxQuestionFields;
}

export function createInitialAnswers(): Record<TaxQuestionId, TaxQuestionAnswer> {
  const answers: Partial<Record<TaxQuestionId, TaxQuestionAnswer>> = {};

  for (const q of OLD_REGIME_QUESTIONS) {
    answers[q.id] = { id: q.id, status: 'not_visited', fields: {} };
  }

  return answers as Record<TaxQuestionId, TaxQuestionAnswer>;
}

/** Whether a "Yes" answer actually has enough amount(s) entered to mean anything. */
export type QuestionCompletion = 'not_visited' | 'skipped' | 'complete' | 'incomplete';

const hasAmount = (v: number | null | undefined): boolean => typeof v === 'number' && v > 0;

/**
 * A question answered "Yes" with every relevant amount still blank changes nothing in the
 * calculation, which is confusing rather than a legitimate "no additional deductions"
 * choice — so it's flagged `incomplete` (red ✗) rather than `complete` (green ✓), and the
 * caller should block calculation until it's fixed or reverted to "No"/left unanswered.
 */
export function getQuestionCompletion(answer: TaxQuestionAnswer): QuestionCompletion {
  if (answer.status === 'not_visited') {
    return 'not_visited';
  }

  if (answer.status === 'answered_no') {
    return 'skipped';
  }

  const f = answer.fields;
  let isComplete: boolean;

  switch (answer.id) {
    case 'hra':
      isComplete = hasAmount(f.hraReceivedAnnual) && hasAmount(f.rentPaidAnnual);
      break;
    case 'section80C':
      isComplete = hasAmount(f.section80CAmount);
      break;
    case 'section80D':
      isComplete = hasAmount(f.section80DSelfAmount) || hasAmount(f.section80DParentsAmount);
      break;
    case 'homeLoanInterest':
      isComplete = hasAmount(f.homeLoanInterestAmount);
      break;
    case 'educationLoanInterest':
      isComplete = hasAmount(f.educationLoanInterestAmount);
      break;
    case 'nps':
      isComplete = hasAmount(f.npsAmount);
      break;
    case 'donations':
      isComplete = hasAmount(f.donationAmount);
      break;
  }

  return isComplete ? 'complete' : 'incomplete';
}

export function hasIncompleteAnswer(answers: Record<TaxQuestionId, TaxQuestionAnswer>): boolean {
  return Object.values(answers).some((a) => getQuestionCompletion(a) === 'incomplete');
}
