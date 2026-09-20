import { Component, DestroyRef, computed, inject, signal } from "@angular/core";
import { calculateEmi, EmiResult } from "../../../core/utilities/emi.util";
import { formatCurrency } from "../../../core/utilities/format.util";
import { amountToIndianWords } from "../../../core/utilities/number-words.util";

type TenureUnit = "years" | "months";

const MIN_SPINNER_MS = 2000;
const MAX_PRINCIPAL_DIGITS = 11;
const MAX_TENURE_MONTHS = 480;

@Component({
  selector: "app-emi-calculator",
  templateUrl: "./emi-calculator.component.html",
  styleUrl: "./emi-calculator.component.scss",
})
export class EmiCalculatorComponent {
  private readonly destroyRef = inject(DestroyRef);
  private timer: ReturnType<typeof setTimeout> | undefined;

  principal = signal<number | null>(null);
  rate = signal("");
  tenure = signal("");
  tenureUnit = signal<TenureUnit>("years");

  calculating = signal(false);
  result = signal<EmiResult | null>(null);
  errors = signal<Record<string, string>>({});

  principalDisplay = computed(() => {
    const value = this.principal();

    return value === null ? "" : value.toLocaleString("en-IN");
  });

  principalWords = computed(() => amountToIndianWords(this.principal() ?? 0));

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
  }

  onPrincipalInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value
      .replace(/\D/g, "")
      .slice(0, MAX_PRINCIPAL_DIGITS);

    this.principal.set(digits ? Number(digits) : null);

    // Write the formatted value back so rejected characters disappear too.
    input.value = this.principalDisplay();
    this.inputChanged();
  }

  onRateInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/[^0-9.]/g, "");
    const dot = value.indexOf(".");

    if (dot !== -1) {
      value =
        value.slice(0, dot + 1) +
        value
          .slice(dot + 1)
          .replace(/\./g, "")
          .slice(0, 2);
    }

    value = value.slice(0, 6);

    this.rate.set(value);
    input.value = value;
    this.inputChanged();
  }

  onTenureInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/\D/g, "").slice(0, 3);

    this.tenure.set(value);
    input.value = value;
    this.inputChanged();
  }

  setTenureUnit(unit: TenureUnit): void {
    this.tenureUnit.set(unit);
    this.inputChanged();
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.calculate();
  }

  calculate(): void {
    if (this.calculating()) {
      return;
    }

    const errors: Record<string, string> = {};

    const principal = this.principal();
    const rate = parseFloat(this.rate());
    const tenure = parseInt(this.tenure(), 10);
    const months = this.tenureUnit() === "years" ? tenure * 12 : tenure;

    if (!principal || principal <= 0) {
      errors["principal"] = "Enter the loan amount";
    }

    if (this.rate() === "" || Number.isNaN(rate)) {
      errors["rate"] = "Enter the interest rate";
    } else if (rate > 100) {
      errors["rate"] = "Interest rate cannot exceed 100%";
    }

    if (!tenure || tenure <= 0) {
      errors["tenure"] = "Enter the loan duration";
    } else if (months > MAX_TENURE_MONTHS) {
      errors["tenure"] = "Duration cannot exceed 40 years";
    }

    this.errors.set(errors);

    if (Object.keys(errors).length > 0) {
      return;
    }

    const emiResult = calculateEmi(principal!, rate, months);

    this.result.set(null);
    this.calculating.set(true);

    // Show the spinner for at least two seconds before revealing the result.
    this.timer = setTimeout(() => {
      this.result.set(emiResult);
      this.calculating.set(false);
    }, MIN_SPINNER_MS);
  }

  /** Clears every input, any error and any result (also cancels a running calculation). */
  reset(): void {
    clearTimeout(this.timer);

    this.principal.set(null);
    this.rate.set("");
    this.tenure.set("");
    this.tenureUnit.set("years");
    this.errors.set({});
    this.result.set(null);
    this.calculating.set(false);
  }

  inr(value: number): string {
    return formatCurrency(Math.round(value), "₹");
  }

  private inputChanged(): void {
    if (this.result()) {
      this.result.set(null);
    }

    if (Object.keys(this.errors()).length > 0) {
      this.errors.set({});
    }
  }
}
