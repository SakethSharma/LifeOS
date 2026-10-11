/**
 * Types for the on-device SMS transaction importer. Nothing here holds a full
 * message body except RawSms, which exists only in memory during a scan.
 */

/** One inbox message as returned by the native plugin. Never persisted. */
export interface RawSms {
  /** Sender address, e.g. "VM-HDFCBK". */
  address: string;
  body: string;
  /** When the phone received it (epoch ms). May be missing/invalid on odd devices. */
  date: number;
}

/** How many calendar months of history to read: current month, last 2, last 3. */
export type SmsHistoryMonths = 1 | 2 | 3;

export const SMS_HISTORY_OPTIONS: { value: SmsHistoryMonths; label: string }[] = [
  { value: 1, label: 'Current month' },
  { value: 2, label: 'Last 2 months' },
  { value: 3, label: 'Last 3 months' },
];

/** Debit = money out, credit = money in, refund = earlier spending returned (reversal included). */
export type SmsTransactionKind = 'debit' | 'credit' | 'refund';

/** Payment methods the parser can name with certainty (subset of PAYMENT_METHODS). */
export type SmsPaymentMethod = 'UPI' | 'Credit Card' | 'Debit Card' | 'Bank Transfer';

/** Structured fields extracted from one message. No raw text. */
export interface SmsTransactionCandidate {
  kind: SmsTransactionKind;
  amount: number;
  /** Local date "YYYY-MM-DD". */
  date: string;
  /** Local time "HH:mm", from the phone's receive time. */
  time?: string;
  /** Last 4 digits of the account/card, when stated. */
  accountSuffix?: string;
  counterparty?: string;
  paymentMethod?: SmsPaymentMethod;
  /** Bank / UPI reference (UTR, RRN…), when stated. */
  reference?: string;
  isAtmWithdrawal?: boolean;
  /** Short label for the bank, from the sender id (e.g. "HDFCBK"). */
  senderLabel?: string;
}

/** Why a message was not imported automatically. Stored with review items; shown in summaries. */
export type SmsSkipReason =
  | 'otp'
  | 'promotion'
  | 'security'
  | 'balance_only'
  | 'failed'
  | 'pending'
  | 'reminder'
  | 'self_transfer'
  | 'no_transaction'
  | 'invalid_amount'
  | 'no_date'
  | 'not_financial';

export type SmsReviewReason =
  | 'ambiguous_direction'
  | 'multiple_amounts'
  | 'no_account_reference'
  | 'promotion_with_transaction'
  | 'possible_manual_duplicate';

export type SmsClassification =
  | { status: 'transaction'; candidate: SmsTransactionCandidate }
  | { status: 'review'; candidate: SmsTransactionCandidate; reason: SmsReviewReason }
  | { status: 'ignored'; reason: SmsSkipReason };

/** Persistent scan checkpoint (one row). */
export interface SmsImportState {
  id: 'sms-import';
  enabled: boolean;
  historyMonths: SmsHistoryMonths;
  /** True once the user has seen the explanation and chosen a period. */
  onboarded: boolean;
  /** Epoch ms: messages from here up to lastSuccessfulScanAt have been scanned. */
  coveredFrom: number | null;
  /** Epoch ms of the end of the last scan that completed successfully. */
  lastSuccessfulSmsScanAt: number | null;
  lastScanAttemptAt: number | null;
  lastScanStatus: SmsScanStatus;
  lastScanSummary: SmsScanSummary | null;
}

export type SmsScanStatus = 'never' | 'success' | 'failed' | 'permission_denied' | 'unavailable';

export interface SmsScanSummary {
  checked: number;
  candidates: number;
  imported: number;
  ignored: number;
  duplicates: number;
  awaitingReview: number;
}

export function defaultSmsImportState(): SmsImportState {
  return {
    id: 'sms-import',
    enabled: false,
    historyMonths: 1,
    onboarded: false,
    coveredFrom: null,
    lastSuccessfulSmsScanAt: null,
    lastScanAttemptAt: null,
    lastScanStatus: 'never',
    lastScanSummary: null,
  };
}

/**
 * Minimal per-message record, so a message is never imported twice and a
 * rejected one never comes back. Keyed by a one-way hash of the message —
 * the text itself is not stored.
 */
export interface SmsMessageRecord {
  messageKey: string;
  status: 'imported' | 'review' | 'rejected';
  /** When the message was received (epoch ms) — used for retention. */
  smsDate: number;
  /** Only for items awaiting review: the extracted fields (never the raw text). */
  candidate?: SmsTransactionCandidate;
  reviewReason?: SmsReviewReason;
  updatedAt: number;
}

/** Metadata older than this is deleted. Imported transactions are never deleted by retention. */
export const SMS_METADATA_RETENTION_DAYS = 200;
