import { Transaction } from '../models/transaction.model';
import {
  DashboardSummary,
  CategoryAggregation,
  MonthlyData,
  DailyData,
  AnalyticsSummary,
  ChartData,
  DateRange,
} from '../models/analytics.model';
import { getMonthKey, getMonthLabel, getDayLabel, isInRange, getPreviousDateRange } from './date.util';

export function filterByDateRange(transactions: Transaction[], range: DateRange): Transaction[] {
  return transactions.filter((t) => isInRange(t.date, range.start, range.end));
}

export function filterByType(transactions: Transaction[], type: 'income' | 'expense'): Transaction[] {
  return transactions.filter((t) => t.type === type);
}

export function calculateSummary(transactions: Transaction[]): DashboardSummary {
  let totalIncome = 0;
  let totalExpenses = 0;

  for (const t of transactions) {
    if (t.type === 'income') {
      totalIncome += t.amount;
    } else {
      totalExpenses += t.amount;
    }
  }

  const netBalance = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? (netBalance / totalIncome) * 100 : 0;
  const transactionCount = transactions.length;
  const avgTransactionValue = transactionCount > 0
    ? transactions.reduce((sum, t) => sum + t.amount, 0) / transactionCount
    : 0;

  return {
    totalIncome,
    totalExpenses,
    netBalance,
    savingsRate: Math.max(0, savingsRate),
    transactionCount,
    avgTransactionValue,
  };
}

export function aggregateByCategory(transactions: Transaction[]): CategoryAggregation[] {
  const map = new Map<string, { amount: number; count: number }>();

  for (const t of transactions) {
    const existing = map.get(t.category) ?? { amount: 0, count: 0 };
    existing.amount += t.amount;
    existing.count += 1;
    map.set(t.category, existing);
  }

  const total = Array.from(map.values()).reduce((sum, v) => sum + v.amount, 0);

  return Array.from(map.entries())
    .map(([category, val]) => ({
      category,
      amount: val.amount,
      percentage: total > 0 ? (val.amount / total) * 100 : 0,
      count: val.count,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function aggregateMonthly(transactions: Transaction[], monthsBack: number = 6): MonthlyData[] {
  const map = new Map<string, MonthlyData>();
  const now = new Date();

  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = getMonthKey(d);
    map.set(key, {
      month: key,
      label: getMonthLabel(d),
      income: 0,
      expenses: 0,
      net: 0,
      savingsRate: 0,
      transactionCount: 0,
    });
  }

  for (const t of transactions) {
    const d = new Date(t.date + 'T00:00:00');
    const key = getMonthKey(d);
    const entry = map.get(key);
    if (entry) {
      if (t.type === 'income') {
        entry.income += t.amount;
      } else {
        entry.expenses += t.amount;
      }
      entry.transactionCount += 1;
    }
  }

  for (const entry of map.values()) {
    entry.net = entry.income - entry.expenses;
    entry.savingsRate = entry.income > 0 ? (entry.net / entry.income) * 100 : 0;
  }

  return Array.from(map.values());
}

export function aggregateDaily(transactions: Transaction[], range: DateRange): DailyData[] {
  const map = new Map<string, DailyData>();
  const days: Date[] = [];

  const cursor = new Date(range.start);
  while (cursor <= range.end) {
    const key = cursor.toISOString().slice(0, 10);
    map.set(key, {
      date: key,
      label: getDayLabel(new Date(cursor)),
      expenses: 0,
      income: 0,
      transactionCount: 0,
    });
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const t of transactions) {
    const entry = map.get(t.date);
    if (entry) {
      if (t.type === 'income') {
        entry.income += t.amount;
      } else {
        entry.expenses += t.amount;
      }
      entry.transactionCount += 1;
    }
  }

  return Array.from(map.values());
}

export function buildChartData(
  transactions: Transaction[],
  range: DateRange,
  monthsBack: number = 6
): ChartData {
  const filtered = filterByDateRange(transactions, range);
  const expenses = filterByType(filtered, 'expense');

  return {
    categories: aggregateByCategory(expenses),
    monthly: aggregateMonthly(transactions, monthsBack),
    daily: aggregateDaily(filtered, range),
  };
}

export function buildAnalyticsSummary(
  transactions: Transaction[],
  range: DateRange
): AnalyticsSummary {
  const filtered = filterByDateRange(transactions, range);
  const summary = calculateSummary(filtered);
  const expenses = filterByType(filtered, 'expense');
  const categories = aggregateByCategory(expenses);

  const topCategory = categories.length > 0 ? categories[0].category : null;
  const topCategoryAmount = categories.length > 0 ? categories[0].amount : 0;

  const result: AnalyticsSummary = {
    totalIncome: summary.totalIncome,
    totalExpenses: summary.totalExpenses,
    netBalance: summary.netBalance,
    topCategory,
    topCategoryAmount,
    avgTransactionValue: summary.avgTransactionValue,
    transactionCount: summary.transactionCount,
  };

  const prevRange = getPreviousDateRange(range);
  const prevFiltered = filterByDateRange(transactions, prevRange);
  if (prevFiltered.length > 0) {
    const prevSummary = calculateSummary(prevFiltered);
    result.previousIncome = prevSummary.totalIncome;
    result.previousExpenses = prevSummary.totalExpenses;
    result.previousNetBalance = prevSummary.netBalance;
    result.incomeChange = result.totalIncome - prevSummary.totalIncome;
    result.expensesChange = result.totalExpenses - prevSummary.totalExpenses;
    result.netBalanceChange = result.netBalance - prevSummary.netBalance;
  }

  return result;
}
