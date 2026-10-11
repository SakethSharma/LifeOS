/**
 * Duplicate detection for SMS imports. Two layers:
 *  - messageKey: a one-way hash of one message (sender + receive time + text),
 *    so the same SMS is never processed twice. The text itself isn't stored.
 *  - importKey: a key for the transaction itself — the bank reference when
 *    there is one, otherwise a fingerprint of the normalized fields plus the
 *    message's receive time (two genuine payments of the same amount to the
 *    same person arrive as different messages, so they stay separate).
 */
import type { Transaction } from '../../../core/models/transaction.model';
import type { RawSms, SmsTransactionCandidate } from '../models/sms-import.model';

/** FNV-1a 53-bit hash → base36. Deterministic, synchronous, not reversible to the text. */
export function stableHash(text: string): string {
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function messageKey(sms: RawSms): string {
  return `m:${stableHash(`${(sms.address ?? '').trim().toUpperCase()}|${sms.date}|${(sms.body ?? '').replace(/\s+/g, ' ').trim()}`)}`;
}

export function importKey(candidate: SmsTransactionCandidate, sms: RawSms): string {
  if (candidate.reference) {
    return `sms:ref:${candidate.kind}:${candidate.reference}`;
  }

  const parts = [
    candidate.kind,
    candidate.amount.toFixed(2),
    candidate.date,
    candidate.accountSuffix ?? '',
    (candidate.counterparty ?? '').toLowerCase().replace(/[^a-z0-9@]/g, ''),
    candidate.paymentMethod ?? '',
    Number.isFinite(sms.date) ? String(sms.date) : '',
  ];
  return `sms:fp:${stableHash(parts.join('|'))}`;
}

/** The LifeOS transaction type for a candidate. Refunds are income that offsets spending. */
export function transactionTypeFor(candidate: SmsTransactionCandidate): Transaction['type'] {
  return candidate.kind === 'debit' ? 'expense' : 'income';
}

/**
 * A manually entered (or other) transaction that looks like the same money
 * movement: same type and amount, within a day. Such candidates go to review
 * instead of being imported as a second copy.
 */
export function findLikelyExisting(candidate: SmsTransactionCandidate, existing: readonly Transaction[]): Transaction | undefined {
  const type = transactionTypeFor(candidate);
  const day = Date.parse(`${candidate.date}T00:00:00`);

  return existing.find((t) => {
    if (t.type !== type || Math.abs(t.amount - candidate.amount) > 0.005) return false;
    const other = Date.parse(`${t.date}T00:00:00`);
    return Number.isFinite(other) && Math.abs(other - day) <= 86_400_000;
  });
}
