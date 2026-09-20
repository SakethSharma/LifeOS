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

  recentTransactions = computed(() => this.monthTransactions().slice(0, 3));

  // Last six months as bar heights (%), scaled to the largest monthly value.
  monthlyBars = computed(() => {
    const months = this.analyticsService.getMonthly(this.transactions(), 6);
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
