import { Component, input, output } from '@angular/core';
import { formatAmountDisplay, parseAmountInput } from '../../utils/input-format.util';
import type { TaxQuestionAnswer, TaxQuestionFields, TaxQuestionMeta } from '../../models/tax-question.model';

@Component({
  selector: 'app-tax-question',
  standalone: true,
  templateUrl: './tax-question.component.html',
  styleUrl: './tax-question.component.scss',
})
export class TaxQuestionComponent {
  meta = input.required<TaxQuestionMeta>();
  answer = input.required<TaxQuestionAnswer>();
  answerChange = output<TaxQuestionAnswer>();

  answerYes(): void {
    this.answerChange.emit({ ...this.answer(), status: 'answered_yes' });
  }

  answerNo(): void {
    this.answerChange.emit({ ...this.answer(), status: 'answered_no', fields: {} });
  }

  display(value: number | null | undefined): string {
    return formatAmountDisplay(value ?? null);
  }

  onField(field: keyof TaxQuestionFields, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = parseAmountInput(input.value);

    input.value = formatAmountDisplay(value);
    this.emitFields({ [field]: value } as Partial<TaxQuestionFields>);
  }

  onToggle(field: keyof TaxQuestionFields, event: Event): void {
    this.emitFields({ [field]: (event.target as HTMLInputElement).checked } as Partial<TaxQuestionFields>);
  }

  private emitFields(partial: Partial<TaxQuestionFields>): void {
    this.answerChange.emit({
      ...this.answer(),
      status: 'answered_yes',
      fields: { ...this.answer().fields, ...partial },
    });
  }
}
