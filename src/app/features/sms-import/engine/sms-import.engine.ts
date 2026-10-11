/**
 * Orchestrates an SMS import: permission → plan the window → read the inbox
 * page by page → classify locally → deduplicate → commit everything in one
 * atomic write → advance the checkpoint. Framework-free; the Angular service
 * supplies the native inbox and the Dexie store.
 *
 * Guarantees:
 *  - one scan at a time (a second call joins the running one);
 *  - nothing is written, and the checkpoint doesn't move, unless the whole
 *    scan succeeds (transactions, message records and checkpoint are one write);
 *  - raw message text never leaves this function — only extracted fields are
 *    kept, and only for items awaiting review.
 */
import type { Transaction } from '../../../core/models/transaction.model';
import type {
  RawSms,
  SmsImportState,
  SmsMessageRecord,
  SmsReviewReason,
  SmsScanSummary,
  SmsTransactionCandidate,
} from '../models/sms-import.model';
import { SMS_METADATA_RETENTION_DAYS } from '../models/sms-import.model';
import { classifySms } from '../utils/sms-parser.util';
import { findLikelyExisting, importKey, messageKey, transactionTypeFor } from '../utils/sms-dedup.util';
import { planSmsScan, shouldAutoScan } from '../utils/sms-scan-plan.util';
import type { SmsScanWindow } from '../utils/sms-scan-plan.util';

export type SmsPermission = 'granted' | 'denied' | 'prompt';

/** Native inbox access (Android). Implemented by the Capacitor plugin bridge. */
export interface SmsInbox {
  isAvailable(): boolean;
  checkPermission(): Promise<SmsPermission>;
  requestPermission(): Promise<SmsPermission>;
  /** Inbox messages received in [from, to], OLDEST first, paged. */
  query(options: { from: number; to: number; offset: number; limit: number }): Promise<RawSms[]>;
}

/** Local persistence. `commit` must be atomic. */
export interface SmsImportStore {
  getState(): Promise<SmsImportState>;
  saveState(state: SmsImportState): Promise<void>;
  getMessageRecords(keys: string[]): Promise<Map<string, SmsMessageRecord>>;
  /** Import keys from `keys` that already exist on transactions. */
  existingImportKeys(keys: string[]): Promise<Set<string>>;
  /** Transactions dated within [fromDate, toDate] ("YYYY-MM-DD"). */
  transactionsBetween(fromDate: string, toDate: string): Promise<Transaction[]>;
  commit(batch: { transactions: Transaction[]; records: SmsMessageRecord[]; state?: SmsImportState }): Promise<void>;
  pruneRecords(olderThan: number): Promise<number>;
  reviewRecords(): Promise<SmsMessageRecord[]>;
}

export type SmsScanStage = 'connecting' | 'reading' | 'filtering' | 'deduplicating' | 'saving' | 'done';

export interface SmsScanProgress {
  stage: SmsScanStage;
  checked: number;
  candidates: number;
}

export type SmsScanOutcome =
  | { status: 'success'; summary: SmsScanSummary; window: SmsScanWindow }
  | { status: 'skipped'; reason: 'disabled' | 'not_onboarded' | 'too_soon' }
  | { status: 'permission_denied' }
  | { status: 'unavailable' }
  | { status: 'cancelled' }
  | { status: 'failed' };

const PAGE_SIZE = 300;
/** Hard cap per scan so a huge inbox can't freeze the app; the checkpoint makes the next scan continue. */
const MAX_MESSAGES_PER_SCAN = 6000;

export class SmsImportEngine {
  private running: Promise<SmsScanOutcome> | null = null;

  constructor(
    private readonly inbox: SmsInbox,
    private readonly store: SmsImportStore,
    private readonly now: () => number = () => Date.now(),
    private readonly newId: () => string = defaultId,
  ) {}

  get isRunning(): boolean {
    return this.running !== null;
  }

  /**
   * Runs a scan, or joins the one already running. `auto` = app-open scan,
   * which is skipped when disabled, not set up yet, or run very recently.
   */
  scan(options: { auto?: boolean; signal?: AbortSignal; onProgress?: (p: SmsScanProgress) => void } = {}): Promise<SmsScanOutcome> {
    if (this.running) return this.running;

    this.running = this.run(options).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Imports a reviewed candidate (possibly edited by the user). */
  async confirmReview(key: string, edited: SmsTransactionCandidate): Promise<Transaction | null> {
    const record = (await this.store.getMessageRecords([key])).get(key);
    if (!record || record.status !== 'review' || !isValidCandidate(edited)) return null;

    const keyForImport = `sms:review:${key}`;
    const transaction = this.toTransaction(edited, keyForImport);
    await this.store.commit({
      transactions: [transaction],
      records: [{ messageKey: key, status: 'imported', smsDate: record.smsDate, updatedAt: this.now() }],
    });
    return transaction;
  }

  /** A false positive: never shown again. Only the hash and date are kept. */
  async rejectReview(key: string): Promise<void> {
    const record = (await this.store.getMessageRecords([key])).get(key);
    if (!record || record.status !== 'review') return;
    await this.store.commit({
      transactions: [],
      records: [{ messageKey: key, status: 'rejected', smsDate: record.smsDate, updatedAt: this.now() }],
    });
  }

  private async run(options: { auto?: boolean; signal?: AbortSignal; onProgress?: (p: SmsScanProgress) => void }): Promise<SmsScanOutcome> {
    const progress = (stage: SmsScanStage, checked = 0, candidates = 0) => options.onProgress?.({ stage, checked, candidates });
    const startedAt = this.now();
    const state = await this.store.getState();

    if (!state.enabled) return { status: 'skipped', reason: 'disabled' };
    if (!state.onboarded) return { status: 'skipped', reason: 'not_onboarded' };
    if (options.auto && !shouldAutoScan(state, startedAt)) return { status: 'skipped', reason: 'too_soon' };

    if (!this.inbox.isAvailable()) {
      await this.store.saveState({ ...state, lastScanAttemptAt: startedAt, lastScanStatus: 'unavailable' });
      return { status: 'unavailable' };
    }

    progress('connecting');
    if ((await this.inbox.checkPermission()) !== 'granted') {
      await this.store.saveState({ ...state, lastScanAttemptAt: startedAt, lastScanStatus: 'permission_denied' });
      return { status: 'permission_denied' };
    }

    const window = planSmsScan(state, startedAt);

    try {
      // 1. Read the window, page by page.
      const messages: RawSms[] = [];
      let truncatedAt: number | null = null;
      for (let offset = 0; ; offset += PAGE_SIZE) {
        if (options.signal?.aborted) return { status: 'cancelled' };
        const page = await this.inbox.query({ from: window.from, to: window.to, offset, limit: PAGE_SIZE });
        messages.push(...page.filter(isUsableMessage));
        progress('reading', messages.length);
        if (page.length < PAGE_SIZE) break;
        if (offset + PAGE_SIZE >= MAX_MESSAGES_PER_SCAN) {
          // Oldest first: everything up to the last message read is complete; the next scan continues from there.
          const lastDate = page[page.length - 1]?.date;
          truncatedAt = Number.isFinite(lastDate) ? lastDate : null;
          break;
        }
      }
      const checkpoint = truncatedAt !== null && truncatedAt < window.to ? truncatedAt : window.to;

      // 2. Classify locally; skip messages already handled.
      progress('filtering', messages.length);
      const keys = messages.map(messageKey);
      const known = await this.store.getMessageRecords([...new Set(keys)]);
      const summary: SmsScanSummary = { checked: messages.length, candidates: 0, imported: 0, ignored: 0, duplicates: 0, awaitingReview: 0 };
      const found: { key: string; sms: RawSms; candidate: SmsTransactionCandidate; reviewReason?: SmsReviewReason }[] = [];
      const seenInBatch = new Set<string>();

      messages.forEach((sms, i) => {
        const key = keys[i];
        if (known.has(key) || seenInBatch.has(key)) {
          summary.duplicates++;
          return;
        }
        seenInBatch.add(key);

        const result = classifySms(sms);
        if (result.status === 'ignored') {
          summary.ignored++;
          return;
        }
        found.push({ key, sms, candidate: result.candidate, ...(result.status === 'review' ? { reviewReason: result.reason } : {}) });
      });
      summary.candidates = found.length;

      if (options.signal?.aborted) return { status: 'cancelled' };

      // 3. Deduplicate against saved transactions and within this batch.
      progress('deduplicating', messages.length, found.length);
      const importKeys = found.map((f) => importKey(f.candidate, f.sms));
      const existingKeys = await this.store.existingImportKeys([...new Set(importKeys)]);
      const dates = found.map((f) => f.candidate.date).sort();
      const nearby = dates.length ? await this.store.transactionsBetween(shiftDay(dates[0], -1), shiftDay(dates[dates.length - 1], 1)) : [];

      const transactions: Transaction[] = [];
      const records: SmsMessageRecord[] = [];
      const acceptedKeys = new Set<string>();
      const recordedAt = this.now();

      found.forEach((f, i) => {
        const keyForImport = importKeys[i];
        const smsDate = f.sms.date;

        if (existingKeys.has(keyForImport) || acceptedKeys.has(keyForImport)) {
          summary.duplicates++;
          records.push({ messageKey: f.key, status: 'imported', smsDate, updatedAt: recordedAt });
          return;
        }

        // Same type and amount within a day (a manual entry, or another SMS about the same payment): ask.
        const reviewReason = f.reviewReason ?? (findLikelyExisting(f.candidate, [...nearby, ...transactions]) ? 'possible_manual_duplicate' : undefined);
        if (reviewReason) {
          summary.awaitingReview++;
          records.push({ messageKey: f.key, status: 'review', smsDate, candidate: f.candidate, reviewReason, updatedAt: recordedAt });
          return;
        }

        acceptedKeys.add(keyForImport);
        transactions.push(this.toTransaction(f.candidate, keyForImport));
        records.push({ messageKey: f.key, status: 'imported', smsDate, updatedAt: recordedAt });
        summary.imported++;
      });

      if (options.signal?.aborted) return { status: 'cancelled' };

      // 4. One atomic write: transactions + message records + checkpoint.
      progress('saving', messages.length, found.length);
      const fresh = await this.store.getState();
      await this.store.commit({
        transactions,
        records,
        state: {
          ...fresh,
          coveredFrom: fresh.coveredFrom === null ? window.from : Math.min(fresh.coveredFrom, window.from),
          lastSuccessfulSmsScanAt: checkpoint,
          lastScanAttemptAt: startedAt,
          lastScanStatus: 'success',
          lastScanSummary: summary,
        },
      });

      await this.store.pruneRecords(this.now() - SMS_METADATA_RETENTION_DAYS * 86_400_000).catch(() => 0);
      progress('done', messages.length, found.length);
      return { status: 'success', summary, window };
    } catch {
      // Nothing was committed; the checkpoint stays where it was, so the next scan resumes safely.
      const fresh = await this.store.getState().catch(() => state);
      await this.store.saveState({ ...fresh, lastScanAttemptAt: startedAt, lastScanStatus: 'failed' }).catch(() => undefined);
      return { status: 'failed' };
    }
  }

  private toTransaction(candidate: SmsTransactionCandidate, keyForImport: string): Transaction {
    const nowIso = new Date(this.now()).toISOString();
    const notes = [
      candidate.accountSuffix ? `A/c ••${candidate.accountSuffix}` : '',
      candidate.reference ? `Ref ${candidate.reference}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    return {
      id: this.newId(),
      type: transactionTypeFor(candidate),
      amount: candidate.amount,
      category: categoryFor(candidate),
      date: candidate.date,
      ...(candidate.time ? { time: candidate.time } : {}),
      description: describe(candidate),
      ...(candidate.paymentMethod ? { paymentMethod: candidate.paymentMethod } : {}),
      ...(notes ? { notes } : {}),
      source: 'sms',
      importKey: keyForImport,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }
}

/** Only well-known merchants get a category; everything else is "Other" rather than a guess. */
const MERCHANT_CATEGORIES: { pattern: RegExp; category: string }[] = [
  { pattern: /swiggy|zomato|domino|mcdonald|kfc|starbucks|blinkit|zepto|bigbasket|instamart/i, category: 'Food' },
  { pattern: /\buber\b|\bola\b|rapido|irctc|redbus|metro|fastag|petrol|fuel|indian ?oil|hpcl|bpcl/i, category: 'Transportation' },
  { pattern: /amazon|flipkart|myntra|ajio|meesho|nykaa|tata ?cliq|reliance ?digital|croma/i, category: 'Shopping' },
  { pattern: /electricity|airtel|\bjio\b|vodafone|\bvi\b|bsnl|broadband|recharge|bescom|tneb|gas bill|water bill/i, category: 'Bills' },
  { pattern: /netflix|spotify|hotstar|prime video|bookmyshow|youtube/i, category: 'Entertainment' },
  { pattern: /apollo|pharmeasy|1mg|netmeds|hospital|clinic|pharmacy/i, category: 'Health' },
];

function categoryFor(candidate: SmsTransactionCandidate): string {
  if (candidate.kind === 'refund') return 'Refund';
  if (candidate.kind === 'credit') return 'Other';
  if (candidate.isAtmWithdrawal) return 'Other';
  const name = candidate.counterparty ?? '';
  return MERCHANT_CATEGORIES.find((m) => m.pattern.test(name))?.category ?? 'Other';
}

function describe(candidate: SmsTransactionCandidate): string {
  const via = candidate.paymentMethod === 'UPI' ? 'UPI ' : candidate.paymentMethod?.endsWith('Card') ? 'Card ' : '';
  if (candidate.kind === 'refund') return candidate.counterparty ? `Refund from ${candidate.counterparty}` : 'Refund';
  if (candidate.kind === 'credit') return candidate.counterparty ? `Received from ${candidate.counterparty}` : 'Money received';
  if (candidate.isAtmWithdrawal) return 'ATM withdrawal';
  return candidate.counterparty ? `${via}payment to ${candidate.counterparty}` : `${via}payment`.replace(/^./, (c) => c.toUpperCase());
}

export function isValidCandidate(c: SmsTransactionCandidate): boolean {
  return (
    (c.kind === 'debit' || c.kind === 'credit' || c.kind === 'refund') &&
    Number.isFinite(c.amount) &&
    c.amount > 0 &&
    c.amount < 1_000_000_000 &&
    /^\d{4}-\d{2}-\d{2}$/.test(c.date) &&
    !Number.isNaN(Date.parse(`${c.date}T00:00:00`))
  );
}

function isUsableMessage(sms: RawSms): boolean {
  return !!sms && typeof sms.body === 'string' && sms.body.length > 0 && sms.body.length < 2000;
}

function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
