import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../../../core/services/settings.service';
import { formatAmountDisplay, parseAmountInput } from '../../utils/input-format.util';
import type { ConfirmedExtractedField } from '../../utils/salary-calculation.util';
import type { DocumentExtractionResult } from '../../models/document-extraction.model';
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
  dismiss = output<void>();

  symbol = this.settingsService.currencySymbol;

  rows = signal<EditableRow[]>([]);

  usableRows = computed(() => this.rows().filter((r) => r.mappedField));
  ignoredRows = computed(() => this.rows().filter((r) => !r.mappedField));
  hasUsableRows = computed(() => this.usableRows().length > 0);

  fieldLabel = (field?: SalaryFieldKey): string => (field ? FIELD_LABELS[field] : '');

  constructor() {
    effect(() => {
      const result = this.result();
      const manual = this.existingManual();

      this.rows.set(
        result.fields.map((f, index) => {
          const existingValue = f.mappedField ? manualValueFor(manual, f.mappedField) : null;
          const frequency: 'monthly' | 'annual' = f.frequency === 'annual' ? 'annual' : 'monthly';

          return {
            id: index,
            rawLabel: f.rawLabel,
            mappedField: f.mappedField,
            value: f.value,
            frequency,
            hasConflict: hasConflict(f.value, frequency, existingValue),
            existingValue,
            useDetected: true,
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
    this.updateRow(row, { value });
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
