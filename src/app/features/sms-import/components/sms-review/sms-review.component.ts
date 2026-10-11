import { Component, inject, input, signal } from '@angular/core';
import { SmsImportService } from '../../services/sms-import.service';
import type { SmsMessageRecord, SmsReviewReason, SmsTransactionCandidate, SmsTransactionKind } from '../../models/sms-import.model';
import { isValidCandidate } from '../../engine/sms-import.engine';

const REASONS: Record<SmsReviewReason, string> = {
  ambiguous_direction: "It's unclear whether money went out or came in.",
  multiple_amounts: 'The message has more than one amount.',
  no_account_reference: "The message doesn't name your account, card or UPI.",
  promotion_with_transaction: 'The message also looks like an offer.',
  possible_manual_duplicate: 'You may already have this transaction.',
};

/**
 * Items the importer wasn't sure about. Shows only the extracted fields —
 * the original message text is never stored. Import (optionally edited),
 * "Not a transaction" (never shown again), or decide later.
 */
@Component({
  selector: 'app-sms-review',
  standalone: true,
  templateUrl: './sms-review.component.html',
  styleUrl: './sms-review.component.scss',
})
export class SmsReviewComponent {
  private sms = inject(SmsImportService);

  symbol = input('₹');

  items = this.sms.reviewItems;
  editing = signal<string | null>(null);
  draft = signal<SmsTransactionCandidate | null>(null);
  error = signal<string | null>(null);
  busy = signal(false);

  reason(item: SmsMessageRecord): string {
    return item.reviewReason ? REASONS[item.reviewReason] : '';
  }

  kindLabel(kind: SmsTransactionKind): string {
    return kind === 'debit' ? 'Expense' : kind === 'refund' ? 'Refund' : 'Income';
  }

  startEdit(item: SmsMessageRecord): void {
    this.editing.set(item.messageKey);
    this.draft.set({ ...item.candidate! });
    this.error.set(null);
  }

  cancelEdit(): void {
    this.editing.set(null);
    this.draft.set(null);
  }

  updateDraft(patch: Partial<SmsTransactionCandidate>): void {
    this.draft.update((d) => (d ? { ...d, ...patch } : d));
  }

  onAmount(event: Event): void {
    this.updateDraft({ amount: Number((event.target as HTMLInputElement).value.replace(/,/g, '')) });
  }

  onKind(event: Event): void {
    this.updateDraft({ kind: (event.target as HTMLSelectElement).value as SmsTransactionKind });
  }

  onDate(event: Event): void {
    this.updateDraft({ date: (event.target as HTMLInputElement).value });
  }

  async confirm(item: SmsMessageRecord): Promise<void> {
    const candidate = this.editing() === item.messageKey ? this.draft() : item.candidate;
    if (!candidate || !isValidCandidate(candidate)) {
      this.error.set('Enter an amount above zero and a valid date.');
      return;
    }
    await this.run(() => this.sms.confirmReview(item.messageKey, candidate));
    this.cancelEdit();
  }

  async reject(item: SmsMessageRecord): Promise<void> {
    await this.run(() => this.sms.rejectReview(item.messageKey));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await action();
    } finally {
      this.busy.set(false);
    }
  }
}
