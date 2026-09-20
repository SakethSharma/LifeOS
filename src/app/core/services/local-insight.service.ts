import { Injectable } from '@angular/core';
import { Transaction } from '../models/transaction.model';
import {
  InsightRequest,
  InsightResponse,
  InsightBlock,
  InsightMetric,
  AnalyticsInsightService,
} from '../models/insight.model';
import { DateRange } from '../models/analytics.model';
import {
  filterByDateRange,
  calculateSummary,
  aggregateByCategory,
  aggregateMonthly,
} from '../utilities/analytics.util';
import { getDateRange, getPreviousDateRange } from '../utilities/date.util';

@Injectable({ providedIn: 'root' })
export class LocalInsightService implements AnalyticsInsightService {
  private transactions: Transaction[] = [];

  setTransactions(transactions: Transaction[]): void {
    this.transactions = transactions;
  }

  isAvailable(): boolean {
    return true;
  }

  getProviderName(): string {
    return 'Local Analysis';
  }

  async analyze(request: InsightRequest): Promise<InsightResponse> {
    await this.delay(600);

    const range = this.resolveRange(request);
    const filtered = filterByDateRange(this.transactions, range);

    if (filtered.length === 0) {
      return {
        blocks: [
          {
            type: 'summary',
            title: 'No Data Available',
            text: `There are no transactions in the selected date range (${range.label}). Try selecting a different date range or adding some transactions first.`,
          },
        ],
        generatedAt: new Date().toISOString(),
        provider: 'local',
      };
    }

    const question = request.question.toLowerCase();
    const blocks: InsightBlock[] = [];

    if (question.includes('biggest') || question.includes('top') || question.includes('largest')) {
      blocks.push(this.biggestSpending(filtered));
    } else if (question.includes('compare') || question.includes('previous') || question.includes('increase')) {
      blocks.push(...this.compareWithPrevious(range));
    } else if (question.includes('pattern') || question.includes('investigate')) {
      blocks.push(...this.patterns(filtered, range));
    } else if (question.includes('summar') || question.includes('summary') || question.includes('activity')) {
      blocks.push(...this.summarize(filtered, range));
    } else if (question.includes('income') || question.includes('over time')) {
      blocks.push(this.incomeExpensesOverTime());
    } else {
      blocks.push(...this.summarize(filtered, range));
    }

    return {
      blocks,
      generatedAt: new Date().toISOString(),
      provider: 'local',
    };
  }

  private resolveRange(request: InsightRequest): DateRange {
    if (request.startDate && request.endDate) {
      return {
        start: new Date(request.startDate + 'T00:00:00'),
        end: new Date(request.endDate + 'T23:59:59'),
        label: 'Custom Range',
      };
    }
    return getDateRange('this_month');
  }

  private biggestSpending(transactions: Transaction[]): InsightBlock {
    const expenses = transactions.filter((t) => t.type === 'expense');
    const categories = aggregateByCategory(expenses);

    return {
      type: 'table',
      title: 'Biggest Spending Categories',
      text: `Your top spending categories based on ${expenses.length} expense transactions.`,
      table: {
        headers: ['Category', 'Amount', 'Percentage', 'Count'],
        rows: categories.slice(0, 5).map((c) => [
          c.category,
          `₹${c.amount.toFixed(0)}`,
          `${c.percentage.toFixed(1)}%`,
          c.count.toString(),
        ]),
      },
    };
  }

  private compareWithPrevious(range: DateRange): InsightBlock[] {
    const current = filterByDateRange(this.transactions, range);
    const prevRange = getPreviousDateRange(range);
    const previous = filterByDateRange(this.transactions, prevRange);

    const currentSummary = calculateSummary(current);
    const prevSummary = calculateSummary(previous);

    const metrics: InsightMetric[] = [
      {
        label: 'Income Change',
        value: `₹${(currentSummary.totalIncome - prevSummary.totalIncome).toFixed(0)}`,
        trend: currentSummary.totalIncome >= prevSummary.totalIncome ? 'up' : 'down',
      },
      {
        label: 'Expense Change',
        value: `₹${(currentSummary.totalExpenses - prevSummary.totalExpenses).toFixed(0)}`,
        trend: currentSummary.totalExpenses <= prevSummary.totalExpenses ? 'up' : 'down',
      },
      {
        label: 'Net Balance Change',
        value: `₹${(currentSummary.netBalance - prevSummary.netBalance).toFixed(0)}`,
        trend: currentSummary.netBalance >= prevSummary.netBalance ? 'up' : 'down',
      },
    ];

    const blocks: InsightBlock[] = [
      {
        type: 'metrics',
        title: `Comparison: ${range.label} vs ${prevRange.label}`,
        metrics,
      },
    ];

    if (currentSummary.totalExpenses > prevSummary.totalExpenses) {
      const diff = currentSummary.totalExpenses - prevSummary.totalExpenses;
      blocks.push({
        type: 'warning',
        text: `Your spending increased by ₹${diff.toFixed(0)} compared to the previous period. Consider reviewing your expense categories to identify areas to reduce spending.`,
      });
    } else {
      blocks.push({
        type: 'recommendation',
        text: `Your spending decreased by ₹${(prevSummary.totalExpenses - currentSummary.totalExpenses).toFixed(0)} compared to the previous period. Great job keeping your expenses in check!`,
      });
    }

    return blocks;
  }

  private patterns(transactions: Transaction[], range: DateRange): InsightBlock[] {
    const expenses = transactions.filter((t) => t.type === 'expense');
    const categories = aggregateByCategory(expenses);
    const monthly = aggregateMonthly(this.transactions, 6);

    const blocks: InsightBlock[] = [];

    blocks.push({
      type: 'bullets',
      title: 'Patterns to Investigate',
      items: categories.slice(0, 5).map((c) => ({
        text: `${c.category}: ₹${c.amount.toFixed(0)} (${c.percentage.toFixed(1)}% of total expenses)`,
      })),
    });

    const highestMonth = monthly.reduce((max, m) => (m.expenses > max.expenses ? m : max), monthly[0]);
    const lowestMonth = monthly.reduce((min, m) => (m.expenses < min.expenses ? m : min), monthly[0]);

    blocks.push({
      type: 'summary',
      text: `Your highest spending month was ${highestMonth.label} (₹${highestMonth.expenses.toFixed(0)}) and your lowest was ${lowestMonth.label} (₹${lowestMonth.expenses.toFixed(0)}). The difference is ₹${(highestMonth.expenses - lowestMonth.expenses).toFixed(0)}.`,
    });

    return blocks;
  }

  private summarize(transactions: Transaction[], range: DateRange): InsightBlock[] {
    const summary = calculateSummary(transactions);
    const expenses = transactions.filter((t) => t.type === 'expense');
    const categories = aggregateByCategory(expenses);

    const blocks: InsightBlock[] = [];

    blocks.push({
      type: 'metrics',
      title: `Financial Summary — ${range.label}`,
      metrics: [
        { label: 'Total Income', value: `₹${summary.totalIncome.toFixed(0)}` },
        { label: 'Total Expenses', value: `₹${summary.totalExpenses.toFixed(0)}` },
        { label: 'Net Balance', value: `₹${summary.netBalance.toFixed(0)}`, trend: summary.netBalance >= 0 ? 'up' : 'down' },
        { label: 'Savings Rate', value: `${summary.savingsRate.toFixed(1)}%` },
        { label: 'Transactions', value: summary.transactionCount.toString() },
        { label: 'Avg Transaction', value: `₹${summary.avgTransactionValue.toFixed(0)}` },
      ],
    });

    if (categories.length > 0) {
      blocks.push({
        type: 'bullets',
        title: 'Top Expense Categories',
        items: categories.slice(0, 5).map((c) => ({
          text: c.category,
          amount: `₹${c.amount.toFixed(0)}`,
          percentage: `${c.percentage.toFixed(1)}%`,
        })),
      });
    }

    if (summary.savingsRate < 20 && summary.totalIncome > 0) {
      blocks.push({
        type: 'warning',
        text: `Your savings rate is ${summary.savingsRate.toFixed(1)}%, which is below the recommended 20%. Consider reducing expenses in your top categories.`,
      });
    } else if (summary.savingsRate >= 20) {
      blocks.push({
        type: 'recommendation',
        text: `Your savings rate of ${summary.savingsRate.toFixed(1)}% is healthy. Keep maintaining this level of savings.`,
      });
    }

    return blocks;
  }

  private incomeExpensesOverTime(): InsightBlock {
    const monthly = aggregateMonthly(this.transactions, 6);

    return {
      type: 'chart',
      title: 'Income vs Expenses Over Time',
      chart: {
        type: 'bar',
        title: 'Monthly Income vs Expenses',
        labels: monthly.map((m) => m.label),
        series: [
          { name: 'Income', data: monthly.map((m) => m.income) },
          { name: 'Expenses', data: monthly.map((m) => m.expenses) },
        ],
      },
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
