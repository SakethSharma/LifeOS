import { Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { TransactionService } from "../../core/services/transaction.service";
import { AnalyticsService } from "../../core/services/analytics.service";
import { SettingsService } from "../../core/services/settings.service";
import { getDateRange, getMonthLabel } from "../../core/utilities/date.util";
import { CurrencyFormatPipe } from "../../shared/pipes/currency-format.pipe";
import { AppFooterComponent } from "../../shared/components/app-footer/app-footer.component";
import { EmiCalculatorComponent } from "./emi-calculator/emi-calculator.component";

@Component({
  selector: "app-home",
  standalone: true,
  templateUrl: "./home.component.html",
  styleUrl: "./home.component.scss",
  imports: [
    RouterLink,
    CurrencyFormatPipe,
    EmiCalculatorComponent,
    AppFooterComponent,
  ],
})
export class HomeComponent {
  private transactionService = inject(TransactionService);
  private analyticsService = inject(AnalyticsService);
  private settingsService = inject(SettingsService);

  // Monthly Overview reads the same transaction signal and the same analytics
  // helpers as the Dashboard, so demo load/undo and edits show up here too.
  transactions = this.transactionService.transactions;
  symbol = this.settingsService.currencySymbol;

  monthLabel = getMonthLabel(new Date());

  monthTransactions = computed(() =>
    this.analyticsService.getFiltered(
      this.transactions(),
      getDateRange("this_month"),
    ),
  );

  summary = computed(() =>
    this.analyticsService.getSummary(this.monthTransactions()),
  );

  recentTransactions = computed(() =>
    this.analyticsService.getRecent(this.monthTransactions(), 3),
  );

  monthlyData = computed(() =>
    this.analyticsService.getMonthly(this.transactions(), 6),
  );

  // "A closer look at the dashboard" section. Everything below is derived from
  // the stored transactions; with none, the template shows empty states.
  hasTransactions = computed(() => this.transactions().length > 0);

  totalBalance = computed(
    () => this.analyticsService.getSummary(this.transactions()).netBalance,
  );

  latestTransactions = computed(() =>
    this.analyticsService.getRecent(this.transactions(), 3),
  );

  insight = computed(() =>
    this.analyticsService.getInsight(this.monthTransactions(), this.symbol()),
  );

  hasTrendData = computed(() => this.monthlyData().some((m) => m.expenses > 0));

  // Monthly expenses as points for a 300x100 SVG viewBox (10px side padding).
  trendPoints = computed(() => {
    const months = this.monthlyData();
    const max = Math.max(1, ...months.map((m) => m.expenses));
    const step = months.length > 1 ? 280 / (months.length - 1) : 0;

    return months
      .map((m, i) => `${10 + i * step},${90 - (m.expenses / max) * 80}`)
      .join(" ");
  });

  // Same line closed down to the chart baseline, for the gradient fill.
  trendAreaPoints = computed(() => {
    const count = this.monthlyData().length;
    const step = count > 1 ? 280 / (count - 1) : 0;

    return `${this.trendPoints()} ${10 + (count - 1) * step},100 10,100`;
  });

  // Last six months as bar heights (%), scaled to the largest monthly value.
  monthlyBars = computed(() => {
    const months = this.monthlyData();
    const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expenses]));

    return {
      income: months.map((m) => ({
        label: m.label,
        value: m.income,
        height: (m.income / max) * 100,
      })),
      expenses: months.map((m) => ({
        label: m.label,
        value: m.expenses,
        height: (m.expenses / max) * 100,
      })),
    };
  });
}
