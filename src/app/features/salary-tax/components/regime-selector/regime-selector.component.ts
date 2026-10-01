import { Component, input, output } from '@angular/core';
import type { TaxRegimeId } from '../../models/tax-rules.model';

export interface TaxYearOption {
  id: string;
  label: string;
}

@Component({
  selector: 'app-regime-selector',
  standalone: true,
  templateUrl: './regime-selector.component.html',
  styleUrl: './regime-selector.component.scss',
})
export class RegimeSelectorComponent {
  regime = input.required<TaxRegimeId>();
  taxYearId = input.required<string>();
  availableYears = input.required<TaxYearOption[]>();

  regimeChange = output<TaxRegimeId>();
  taxYearChange = output<string>();

  select(regime: TaxRegimeId): void {
    if (regime !== this.regime()) {
      this.regimeChange.emit(regime);
    }
  }

  onYearChange(event: Event): void {
    this.taxYearChange.emit((event.target as HTMLSelectElement).value);
  }
}
