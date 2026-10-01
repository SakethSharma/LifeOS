import type { Transaction } from '../models/transaction.model';
import type { AiFinancialContext } from './ai-contract';
import { aggregateByCategory, calculateSummary } from '../utilities/analytics.util';
import { isInRange } from '../utilities/date.util';
import { toDateString } from '../utilities/format.util';

/**
 * Results of the LifeOS salary/tax engine, when the user has run it this
 * session. Numbers only — no names, PAN, employer, or document content.
 */
export interface SalaryTaxFacts {
  taxYear: string;
  regime: string;
  annualCtc: number;
  grossAnnualSalary: number;
  standardDeduction: number;
  totalOtherDeductions: number;
  taxableIncome: number;
  annualIncomeTax: number;
  monthlyIncomeTax: number;
  employeePfAnnual: number;
  monthlyTakeHome: number;
  annualTakeHome: number;
}

export interface FinancialContextInput {
  transactions: Transaction[];
  currencyCode: string;
  currencySymbol: string;
  now: Date;
  salaryTax?: SalaryTaxFacts | null;
}

const TOP_CATEGORIES = 6;
const LARGEST_EXPENSES = 5;
const TREND_MONTHS = 6;

/**
 * Builds the facts the AI may use, from numbers LifeOS already computed.
 *
 * Privacy by construction: only amounts, categories, dates and counts leave
 * the device. Transaction descriptions, notes, payment methods and ids are
 * never included — they are free text that can hold names, account or card
 * numbers, or UPI ids.
 */
export function buildFinancialContext(input: FinancialContextInput): AiFinancialContext {
  const { transactions, now } = input;
  const today = startOfDay(now);

  const currentStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const previousStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const previousEnd = endOfDay(new Date(today.getFullYear(), today.getMonth(), 0));
  const trendStart = new Date(today.getFullYear(), today.getMonth() - (TREND_MONTHS - 1), 1);
  const ninetyDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 89);

  const context: AiFinancialContext = {
    generatedOn: toDateString(today),
    currency: { code: input.currencyCode, symbol: input.currencySymbol },
    amountsNote: 'All amounts are totals computed by LifeOS. "savings" means income minus expenses for that period.',
    recordedTransactions: transactions.length,
  };

  if (transactions.length === 0) {
    context['dataNote'] = 'The user has not recorded any income or expense transactions in LifeOS yet.';
  } else {
    const dates = transactions.map((t) => t.date).sort();

    context['includesDemoData'] = transactions.some((t) => t.isDemo);
    context['firstTransactionDate'] = dates[0];
    context['lastTransactionDate'] = dates[dates.length - 1];
    context['currentMonth'] = periodFacts(transactions, currentStart, endOfDay(today), 'month to date');
    context['previousMonth'] = periodFacts(transactions, previousStart, previousEnd, 'full month');
    context['lastSixMonths'] = {
      monthly: monthlyTrend(transactions, today),
      topExpenseCategories: categoryFacts(inRange(transactions, trendStart, endOfDay(today), 'expense')),
    };
    context['largestExpensesLast90Days'] = inRange(transactions, ninetyDaysAgo, endOfDay(today), 'expense')
      .sort((a, b) => b.amount - a.amount)
      .slice(0, LARGEST_EXPENSES)
      .map((t) => ({ date: t.date, category: t.category, amount: round(t.amount) }));
  }

  context['salaryTax'] = input.salaryTax
    ? { source: 'LifeOS salary & tax calculator (deterministic)', ...roundAll(input.salaryTax) }
    : { available: false, note: 'The user has not run the LifeOS salary & tax calculator this session.' };

  return context;
}

function periodFacts(transactions: Transaction[], start: Date, end: Date, coverage: string): Record<string, unknown> {
  const inPeriod = inRange(transactions, start, end);
  const summary = calculateSummary(inPeriod);

  return {
    label: start.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    coverage,
    from: toDateString(start),
    to: toDateString(end),
    income: round(summary.totalIncome),
    expenses: round(summary.totalExpenses),
    savings: round(summary.netBalance),
    savingsRatePercent: summary.totalIncome > 0 ? round((summary.netBalance / summary.totalIncome) * 100) : null,
    transactionCount: summary.transactionCount,
    topExpenseCategories: categoryFacts(inPeriod.filter((t) => t.type === 'expense')),
    incomeBySource: aggregateByCategory(inPeriod.filter((t) => t.type === 'income'))
      .slice(0, 4)
      .map((c) => ({ source: c.category, amount: round(c.amount) })),
  };
}

function monthlyTrend(transactions: Transaction[], today: Date): Record<string, unknown>[] {
  const months: Record<string, unknown>[] = [];

  for (let offset = TREND_MONTHS - 1; offset >= 0; offset--) {
    const start = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    const end = offset === 0 ? endOfDay(today) : endOfDay(new Date(today.getFullYear(), today.getMonth() - offset + 1, 0));
    const summary = calculateSummary(inRange(transactions, start, end));

    months.push({
      month: start.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
      income: round(summary.totalIncome),
      expenses: round(summary.totalExpenses),
      savings: round(summary.netBalance),
    });
  }

  return months;
}

function categoryFacts(expenses: Transaction[]): Record<string, unknown>[] {
  return aggregateByCategory(expenses)
    .slice(0, TOP_CATEGORIES)
    .map((c) => ({
      category: c.category,
      amount: round(c.amount),
      sharePercent: round(c.percentage),
      transactions: c.count,
    }));
}

function inRange(transactions: Transaction[], start: Date, end: Date, type?: 'income' | 'expense'): Transaction[] {
  return transactions.filter((t) => (!type || t.type === type) && isInRange(t.date, start, end));
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundAll(facts: SalaryTaxFacts): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(facts).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value]),
  );
}
