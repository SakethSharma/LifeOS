import { Injectable } from '@angular/core';
import { Transaction } from '../models/transaction.model';
import { DateRange } from '../models/analytics.model';
import {
  filterByDateRange,
  calculateSummary,
  aggregateByCategory,
  aggregateMonthly,
  aggregateDaily,
  buildAnalyticsSummary,
  buildChartData,
} from '../utilities/analytics.util';

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  getFiltered(transactions: Transaction[], range: DateRange): Transaction[] {
    return filterByDateRange(transactions, range);
  }

  getSummary(transactions: Transaction[]) {
    return calculateSummary(transactions);
  }

  getCategories(transactions: Transaction[]) {
    return aggregateByCategory(transactions);
  }

  getMonthly(transactions: Transaction[], monthsBack: number = 6) {
    return aggregateMonthly(transactions, monthsBack);
  }

  getDaily(transactions: Transaction[], range: DateRange) {
    return aggregateDaily(transactions, range);
  }

  getChartData(transactions: Transaction[], range: DateRange, monthsBack: number = 6) {
    return buildChartData(transactions, range, monthsBack);
  }

  getAnalyticsSummary(transactions: Transaction[], range: DateRange) {
    return buildAnalyticsSummary(transactions, range);
  }
}
