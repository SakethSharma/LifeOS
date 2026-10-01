import { Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { formatAmountDisplay, parseAmountInput } from '../../utils/input-format.util';
import type { SalaryManualInput } from '../../models/salary.model';

@Component({
  selector: 'app-salary-input',
  standalone: true,
  templateUrl: './salary-input.component.html',
  styleUrl: './salary-input.component.scss',
})
export class SalaryInputComponent {
  manual = input.required<SalaryManualInput>();
  manualChange = output<Partial<SalaryManualInput>>();

  private host = inject(ElementRef<HTMLElement>);

  showBreakup = signal(false);

  /** Collapses the exact-breakup fields (values themselves live in the parent). */
  resetView(): void {
    this.showBreakup.set(false);
  }

  /** Brings the CTC field into view and focuses it — the manual-entry path when AI can't help. */
  focusFirstField(): void {
    const field = (this.host.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#st-ctc');
    field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field?.focus({ preventScroll: true });
  }

  ctcDisplay = computed(() => formatAmountDisplay(this.manual().annualCtc));
  basicDisplay = computed(() => formatAmountDisplay(this.manual().basicAnnual));
  hraDisplay = computed(() => formatAmountDisplay(this.manual().hraAnnual));
  specialDisplay = computed(() => formatAmountDisplay(this.manual().specialAllowanceAnnual));
  pfDisplay = computed(() => formatAmountDisplay(this.manual().employeePfAnnual));
  professionalTaxDisplay = computed(() => formatAmountDisplay(this.manual().professionalTaxAnnual));
  otherDisplay = computed(() => formatAmountDisplay(this.manual().otherDeductionsAnnual));

  toggleBreakup(): void {
    this.showBreakup.update((v) => !v);
  }

  onField(field: keyof SalaryManualInput, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = parseAmountInput(input.value);

    input.value = formatAmountDisplay(value);
    this.manualChange.emit({ [field]: value } as Partial<SalaryManualInput>);
  }
}
