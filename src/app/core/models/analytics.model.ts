import { Transaction } from './transaction.model';

export interface DashboardSummary {
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  savingsRate: number;
  transactionCount: number;
  avgTransactionValue: number;
}

export interface CategoryAggregation {
  category: string;
  amount: number;
  percentage: number;
  count: number;
}

export interface MonthlyData {
  month: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
  savingsRate: number;
  transactionCount: number;
}

export interface DailyData {
  date: string;
  label: string;
  expenses: number;
  income: number;
  transactionCount: number;
}

export interface AnalyticsSummary {
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  topCategory: string | null;
  topCategoryAmount: number;
  avgTransactionValue: number;
  transactionCount: number;
  previousIncome?: number;
  previousExpenses?: number;
  previousNetBalance?: number;
  incomeChange?: number;
  expensesChange?: number;
  netBalanceChange?: number;
}

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

export interface ChartData {
  categories: CategoryAggregation[];
  monthly: MonthlyData[];
  daily: DailyData[];
}

export interface PeriodComparison {
  current: DashboardSummary;
  previous?: DashboardSummary;
  incomeChange?: number;
  expensesChange?: number;
  netBalanceChange?: number;
}
