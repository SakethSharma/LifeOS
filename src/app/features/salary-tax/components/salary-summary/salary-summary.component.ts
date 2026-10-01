import { Component, inject, input, model } from '@angular/core';
import { SettingsService } from '../../../../core/services/settings.service';
import { CurrencyFormatPipe } from '../../../../shared/pipes/currency-format.pipe';
import { CollapsibleSectionComponent } from '../../../../shared/components/collapsible-section/collapsible-section.component';
import type { TaxCalculationResult } from '../../models/tax.model';

@Component({
  selector: 'app-salary-summary',
  standalone: true,
  imports: [CurrencyFormatPipe, CollapsibleSectionComponent],
  templateUrl: './salary-summary.component.html',
  styleUrl: './salary-summary.component.scss',
})
export class SalarySummaryComponent {
  private settingsService = inject(SettingsService);

  result = input.required<TaxCalculationResult>();
  expanded = model<boolean>(true);
  symbol = this.settingsService.currencySymbol;

  pfLabel(): string {
    const source = this.result().salary.employeePfAnnual.source;

    if (source === 'estimated') return 'Estimated Employee PF';
    if (source === 'not_provided') return 'Employee PF (Not provided)';
    return 'Employee PF';
  }

  otherDeductionsLabel(): string {
    return this.result().salary.otherDeductionsAnnual.source === 'not_provided'
      ? 'Other Deductions (Not provided)'
      : 'Other Deductions';
  }

  isEstimate(source: string): boolean {
    return source === 'estimated';
  }
}
