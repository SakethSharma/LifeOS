import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../../../core/services/settings.service';
import { formatAmountDisplay, parseAmountInput } from '../../utils/input-format.util';
import type { ConfirmedExtractedField } from '../../utils/salary-calculation.util';
import type { DocumentExtractionResult, ExtractedTaxDetails } from '../../models/document-extraction.model';
import { DEDUCTION_KEYS, DEDUCTION_LABELS } from '../../utils/tax-extraction.util';
import type { SalaryFieldKey, SalaryManualInput } from '../../models/salary.model';

interface EditableRow {
  id: number;
  rawLabel: string;
  mappedField?: SalaryFieldKey;
  value: number;
  frequency: 'monthly' | 'annual';
  hasConflict: boolean;
  existingValue: number | null;
  useDetected: boolean;
  /** AI amount that doesn't match the user's text; cleared once the user edits it. */
  unverified: boolean;
}

const FIELD_LABELS: Record<SalaryFieldKey, string> = {
  annualCtc: 'Annual CTC',
  basicAnnual: 'Basic Salary',
  hraAnnual: 'HRA',
  specialAllowanceAnnual: 'Special Allowance',
  grossAnnual: 'Gross Salary',
  employeePfAnnual: 'Employee PF',
  professionalTaxAnnual: 'Professional Tax',
  otherDeductionsAnnual: 'Other Deductions',
};

@Component({
  selector: 'app-detected-salary-data',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './detected-salary-data.component.html',
  styleUrl: './detected-salary-data.component.scss',
})
export class DetectedSalaryDataComponent {
  private settingsService = inject(SettingsService);

  result = input.required<DocumentExtractionResult>();
  existingManual = input.required<SalaryManualInput>();

  confirm = output<ConfirmedExtractedField[]>();
  /** Emitted just before `confirm` when the user keeps "apply regime & deductions" ticked. */
  confirmTaxDetails = output<ExtractedTaxDetails>();
  dismiss = output<void>();

  /** Apply the detected regime / year / deductions too (the user can untick). */
  applyTaxDetails = signal(true);

  /** Detected regime, year, deductions, rent and TDS as display lines. */
  taxDetailLines = computed(() => {
    const d = this.result().taxDetails;
    if (!d) return [];

    const lines: { label: string; value: string }[] = [];
    if (d.regime) lines.push({ label: 'Tax regime', value: d.regime === 'new' ? 'New Regime' : 'Old Regime' });
    if (d.financialYear) lines.push({ label: 'Financial year', value: d.financialYear });
    for (const key of DEDUCTION_KEYS) {
      const amount = d.deductions[key];
      if (amount) lines.push({ label: DEDUCTION_LABELS[key], value: `${this.symbol()}${formatAmountDisplay(amount)} / year` });
    }
    if (d.rentPaidAnnual) lines.push({ label: 'Rent paid', value: `${this.symbol()}${formatAmountDisplay(d.rentPaidAnnual)} / year` });
    if (d.tdsAnnual) lines.push({ label: 'TDS already deducted', value: `${this.symbol()}${formatAmountDisplay(d.tdsAnnual)} / year` });
    return lines;
  });

  /** True when an AI provider (not the on-device parser) produced these values. */
  readByAi = computed(() => {
    const by = this.result().extractedBy;
    return !!by && by !== 'LifeOS on this device';
  });

  symbol = this.settingsService.currencySymbol;

  rows = signal<EditableRow[]>([]);

  usableRows = computed(() => this.rows().filter((r) => r.mappedField));
  ignoredRows = computed(() => this.rows().filter((r) => !r.mappedField));
  hasUsableRows = computed(() => this.usableRows().length > 0);
  /** Amounts the user still has to check (they didn't match what was typed). */
  uncheckedRows = computed(() => this.usableRows().filter((r) => r.unverified));

  fieldLabel = (field?: SalaryFieldKey): string => (field ? FIELD_LABELS[field] : '');

  constructor() {
    effect(() => {
      const result = this.result();
      const manual = this.existingManual();

      this.rows.set(
        result.fields.map((f, index) => {
          const existingValue = f.mappedField ? manualValueFor(manual, f.mappedField) : null;
          // A CTC is quoted per year unless the source says otherwise.
          const frequency: 'monthly' | 'annual' =
            f.frequency === 'annual' || (f.frequency === 'unknown' && f.mappedField === 'annualCtc') ? 'annual' : 'monthly';

          return {
            id: index,
            rawLabel: f.rawLabel,
            mappedField: f.mappedField,
            value: f.value,
            frequency,
            hasConflict: hasConflict(f.value, frequency, existingValue),
            existingValue,
            useDetected: true,
            unverified: !!f.unverified,
          };
        }),
      );
    });
  }

  display(value: number): string {
    return formatAmountDisplay(value);
  }

  onValueEdit(row: EditableRow, event: Event): void {
    const value = parseAmountInput((event.target as HTMLInputElement).value) ?? 0;
    this.updateRow(row, { value, unverified: false });
  }

  onFrequencyChange(row: EditableRow, event: Event): void {
    const frequency = (event.target as HTMLSelectElement).value as 'monthly' | 'annual';
    this.updateRow(row, { frequency });
  }

  chooseDetected(row: EditableRow): void {
    this.updateRow(row, { useDetected: true });
  }

  chooseExisting(row: EditableRow): void {
    this.updateRow(row, { useDetected: false });
  }

  confirmAll(): void {
    const details = this.result().taxDetails;
    if (details && this.applyTaxDetails()) {
      this.confirmTaxDetails.emit(details);
    }

    const fields: ConfirmedExtractedField[] = this.usableRows()
      .filter((r) => !r.hasConflict || r.useDetected)
      .map((r) => ({
        field: r.mappedField!,
        value: r.value,
        frequency: r.frequency,
        note: 'Detected and confirmed by you',
      }));

    this.confirm.emit(fields);
  }

  private updateRow(target: EditableRow, patch: Partial<EditableRow>): void {
    this.rows.update((rows) =>
      rows.map((r) => {
        if (r !== target) {
          return r;
        }

        const next = { ...r, ...patch };
        return { ...next, hasConflict: hasConflict(next.value, next.frequency, next.existingValue) };
      }),
    );
  }
}

function hasConflict(value: number, frequency: 'monthly' | 'annual', existingAnnualValue: number | null): boolean {
  if (existingAnnualValue === null) {
    return false;
  }

  const annualized = frequency === 'monthly' ? value * 12 : value;
  return Math.round(annualized) !== Math.round(existingAnnualValue);
}

function manualValueFor(manual: SalaryManualInput, field: SalaryFieldKey): number | null {
  switch (field) {
    case 'annualCtc':
      return manual.annualCtc;
    case 'basicAnnual':
      return manual.basicAnnual;
    case 'hraAnnual':
      return manual.hraAnnual;
    case 'specialAllowanceAnnual':
      return manual.specialAllowanceAnnual;
    case 'employeePfAnnual':
      return manual.employeePfAnnual;
    case 'professionalTaxAnnual':
      return manual.professionalTaxAnnual;
    case 'otherDeductionsAnnual':
      return manual.otherDeductionsAnnual;
    case 'grossAnnual':
      return null;
  }
}
