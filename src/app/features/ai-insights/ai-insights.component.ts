import { Component, inject, signal, computed, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TransactionService } from "../../core/services/transaction.service";
import { SettingsService } from "../../core/services/settings.service";
import { LocalInsightService } from "../../core/services/local-insight.service";
import {
  InsightResponse,
  InsightBlock,
  InsightChartData,
} from "../../core/models/insight.model";
import {
  DateRangePreset,
  DATE_RANGE_PRESETS,
} from "../../core/models/settings.model";
import { getDateRange } from "../../core/utilities/date.util";
import { toDateString } from "../../core/utilities/format.util";
import { ChartSeries } from "../../shared/components/chart/chart.component";

@Component({
  selector: "app-ai-insights",
  standalone: true,
  templateUrl: "./ai-insights.component.html",
  styleUrl: "./ai-insights.component.scss",
  imports: [FormsModule],
})
export class AiInsightsComponent implements OnInit {
  private transactionService = inject(TransactionService);
  private settingsService = inject(SettingsService);
  private insightService = inject(LocalInsightService);

  transactions = this.transactionService.transactions;
  symbol = this.settingsService.currencySymbol;

  question = signal("");
  loading = signal(false);
  response = signal<InsightResponse | null>(null);

  selectedPreset = signal<DateRangePreset>("this_month");
  customStart = signal("");
  customEnd = signal("");

  presets = DATE_RANGE_PRESETS;

  hasTransactions = computed(() => this.transactions().length > 0);

  suggestedPrompts = [
    "Summarize my finances",
    "What are my biggest spending categories?",
    "Compare this month with the previous month",
    "Show me spending patterns",
    "Show income vs expenses over time",
  ];

  private dateRange = computed(() => {
    if (this.selectedPreset() === "custom") {
      return getDateRange(
        "custom",
        this.customStart() || undefined,
        this.customEnd() || undefined,
      );
    }
    return getDateRange(this.selectedPreset());
  });

  ngOnInit(): void {
    const settings = this.settingsService.current;
    if (settings) {
      this.selectedPreset.set(settings.defaultDateRange);
    }
    const range = this.dateRange();
    this.customStart.set(toDateString(range.start));
    this.customEnd.set(toDateString(range.end));
  }

  selectPreset(preset: DateRangePreset): void {
    this.selectedPreset.set(preset);
    if (preset !== "custom") {
      const range = getDateRange(preset);
      this.customStart.set(toDateString(range.start));
      this.customEnd.set(toDateString(range.end));
    }
  }

  // Placeholder result card. Holds response blocks so future AI output
  // (text, charts, tables, reports) can render through the same structure.
  promptResult = signal<InsightBlock[] | null>(null);

  submitPrompt(): void {
    if (!this.question().trim()) return;

    this.promptResult.set([
      { type: "summary", text: "AI analysis is coming soon." },
    ]);
  }

  onPromptEnter(event: Event): void {
    const keyEvent = event as KeyboardEvent;

    // Shift+Enter inserts a newline; Enter submits. Ignore IME composition.
    if (keyEvent.shiftKey || keyEvent.isComposing) return;

    keyEvent.preventDefault();
    this.submitPrompt();
  }

  dismissPromptResult(): void {
    this.promptResult.set(null);
  }

  askQuestion(prompt?: string): void {
    const q = (prompt ?? this.question()).trim();
    if (!q || this.loading()) return;

    this.question.set(q);
    this.loading.set(true);
    this.response.set(null);

    this.insightService.setTransactions(this.transactions());

    const range = this.dateRange();

    this.insightService
      .analyze({
        question: q,
        startDate: toDateString(range.start),
        endDate: toDateString(range.end),
      })
      .then((res) => {
        this.response.set(res);
        this.loading.set(false);
      })
      .catch(() => {
        this.loading.set(false);
      });
  }

  chartLabels(chart: InsightChartData): string[] {
    return chart.labels;
  }

  chartSeries(chart: InsightChartData): ChartSeries[] {
    return chart.series.map((s) => ({ name: s.name, data: s.data }));
  }

  chartType(chart: InsightChartData): "bar" | "line" | "donut" {
    if (chart.type === "pie") return "donut";
    return chart.type;
  }

  trackBlock(index: number, block: InsightBlock): string {
    return `${index}-${block.type}`;
  }
}
