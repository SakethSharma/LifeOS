import { Component, inject, computed, signal, OnInit } from "@angular/core";
import { Router } from "@angular/router";
import { TransactionService } from "../../core/services/transaction.service";
import { SettingsService } from "../../core/services/settings.service";
import { AnalyticsService } from "../../core/services/analytics.service";
import { DemoDataService } from "../../core/services/demo-data.service";
import {
  DateRangePreset,
  DATE_RANGE_PRESETS,
} from "../../core/models/settings.model";
import { getDateRange } from "../../core/utilities/date.util";
import {
  ChartComponent,
  ChartSeries,
} from "../../shared/components/chart/chart.component";
import { EmptyStateComponent } from "../../shared/components/empty-state/empty-state.component";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";
import { ConfirmDialogComponent } from "../../shared/components/confirm-dialog/confirm-dialog.component";
import { CurrencyFormatPipe } from "../../shared/pipes/currency-format.pipe";
import { DateFormatPipe } from "../../shared/pipes/date-format.pipe";

@Component({
  selector: "app-dashboard",
  standalone: true,
  templateUrl: "./dashboard.component.html",
  styleUrl: "./dashboard.component.scss",
  imports: [
    ChartComponent,
    EmptyStateComponent,
    PageHeaderComponent,
    ConfirmDialogComponent,
    CurrencyFormatPipe,
    DateFormatPipe,
  ],
})
export class DashboardComponent implements OnInit {
  private transactionService = inject(TransactionService);
  private settingsService = inject(SettingsService);
  private analyticsService = inject(AnalyticsService);
  private demoData = inject(DemoDataService);
  private router = inject(Router);

  transactions = this.transactionService.transactions;
  loading = this.transactionService.loading;

  loadingDemo = signal(false);
  removingDemo = signal(false);
  showRemoveDemoConfirm = signal(false);

  hasDemoData = computed(() =>
    this.transactions().some((t) => t.isDemo === true),
  );

  selectedPreset = signal<DateRangePreset>("this_month");

  presets = DATE_RANGE_PRESETS;

  symbol = this.settingsService.currencySymbol;

  dateFormat = computed(
    () => this.settingsService.settings()?.dateFormat ?? "MMM d, yyyy",
  );

  dateRange = computed(() => getDateRange(this.selectedPreset()));

  dateRangeLabel = computed(() => this.dateRange().label);

  filteredTransactions = computed(() => {
    const range = this.dateRange();

    return this.analyticsService.getFiltered(this.transactions(), range);
  });

  summary = computed(() =>
    this.analyticsService.getSummary(this.filteredTransactions()),
  );

  monthlyData = computed(() =>
    this.analyticsService.getMonthly(this.transactions(), 6),
  );

  monthlyLabels = computed(() =>
    this.monthlyData().map((month) => month.label),
  );

  monthlySeries = computed<ChartSeries[]>(() => [
    {
      name: "Income",
      data: this.monthlyData().map((month) => month.income),
    },
    {
      name: "Expenses",
      data: this.monthlyData().map((month) => month.expenses),
    },
  ]);

  categoryData = computed(() => {
    const expenses = this.filteredTransactions().filter(
      (transaction) => transaction.type === "expense",
    );

    return this.analyticsService.getCategories(expenses);
  });

  categoryLabels = computed(() =>
    this.categoryData().map((category) => category.category),
  );

  categorySeries = computed<ChartSeries[]>(() => [
    {
      name: "Expenses",
      data: this.categoryData().map((category) => category.amount),
    },
  ]);

  trendLabels = computed(() => this.monthlyData().map((month) => month.label));

  trendSeries = computed<ChartSeries[]>(() => [
    {
      name: "Expenses",
      data: this.monthlyData().map((month) => month.expenses),
    },
  ]);

  topCategories = computed(() => this.categoryData().slice(0, 5));

  recentTransactions = computed(() => this.filteredTransactions().slice(0, 8));

  ngOnInit(): void {
    const settings = this.settingsService.current;

    if (settings) {
      this.selectedPreset.set(settings.defaultDateRange);
    }
  }

  selectPreset(preset: DateRangePreset): void {
    this.selectedPreset.set(preset);
  }

  addTransaction(): void {
    this.router.navigate(["/transactions"]);
  }

  viewAllTransactions(): void {
    this.router.navigate(["/transactions"]);
  }

  async loadDemo(): Promise<void> {
    this.loadingDemo.set(true);

    try {
      const demo = this.demoData.generate(120);

      await this.transactionService.bulkAdd(demo);
    } finally {
      this.loadingDemo.set(false);
    }
  }

  confirmRemoveDemo(): void {
    this.showRemoveDemoConfirm.set(true);
  }

  async removeDemo(): Promise<void> {
    this.removingDemo.set(true);
    try {
      await this.transactionService.deleteAllDemo();
    } finally {
      this.removingDemo.set(false);
      this.showRemoveDemoConfirm.set(false);
    }
  }
}
