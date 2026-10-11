/**
 * SMS importer tests — parser, date ranges, deduplication and the scan engine.
 * All messages are synthetic; no real SMS, accounts or credentials.
 * Run with: npm run test:ai
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifySms, parseAmount } from '../utils/sms-parser.util';
import { historyPeriodStart, planSmsScan, shouldAutoScan, SMS_SCAN_OVERLAP_MS } from '../utils/sms-scan-plan.util';
import { findLikelyExisting, importKey, messageKey } from '../utils/sms-dedup.util';
import { SmsImportEngine } from '../engine/sms-import.engine';
import type { SmsImportStore, SmsInbox, SmsPermission } from '../engine/sms-import.engine';
import { defaultSmsImportState } from '../models/sms-import.model';
import type { RawSms, SmsClassification, SmsImportState, SmsMessageRecord } from '../models/sms-import.model';
import type { Transaction } from '../../../core/models/transaction.model';
import { buildFinancialContext } from '../../../core/ai/financial-context.builder';

const at = (iso: string) => new Date(iso).getTime();
const sms = (body: string, iso = '2026-10-05T14:32:00', address = 'VM-SYNBNK'): RawSms => ({ address, body, date: at(iso) });

function txn(c: SmsClassification) {
  assert.ok(c.status === 'transaction', `expected transaction, got ${JSON.stringify(c)}`);
  return c.candidate;
}

function ignoredReason(c: SmsClassification) {
  assert.equal(c.status, 'ignored', JSON.stringify(c));
  return (c as { reason: string }).reason;
}

// ---- Parser: transactions ---------------------------------------------------------

test('1. UPI debit: amount, account, payee, method, reference, date', () => {
  const c = txn(classifySms(sms('Rs.250.00 debited from A/c XX1234 on 05-10-26 to VPA swiggy@ybl (UPI Ref No 612345678901). Not you? Call 1800000000.')));
  assert.deepEqual(
    { kind: c.kind, amount: c.amount, acct: c.accountSuffix, to: c.counterparty, method: c.paymentMethod, ref: c.reference, date: c.date },
    { kind: 'debit', amount: 250, acct: '1234', to: 'swiggy@ybl', method: 'UPI', ref: '612345678901', date: '2026-10-05' },
  );
});

test('1b. debit notice that names the payee as "credited" stays a debit', () => {
  const c = txn(classifySms(sms('SynBank Acct XX123 debited for Rs 1,250.00 on 05-Oct-26; RAVI KUMAR credited. UPI:612345678902. Call 1800 for dispute.')));
  assert.equal(c.kind, 'debit');
  assert.equal(c.amount, 1250);
  assert.equal(c.reference, '612345678902');
});

test('2. bank credit (salary via NEFT)', () => {
  const c = txn(classifySms(sms('INR 85,000.00 credited to A/c no. XX5678 on 01-10-26 by NEFT from ACME PVT LTD. Avl Bal INR 1,02,345.50', '2026-10-01T09:10:00')));
  assert.equal(c.kind, 'credit');
  assert.equal(c.amount, 85000, 'the balance is not taken as the amount');
  assert.equal(c.paymentMethod, 'Bank Transfer');
  assert.equal(c.counterparty, 'ACME PVT LTD');
});

test('3. debit card purchase', () => {
  const c = txn(classifySms(sms('Rs 2,499.00 spent on your SynBank Debit Card ending 4321 at AMAZON on 05/10/2026. Avl Lmt: Rs 50,000')));
  assert.deepEqual([c.kind, c.amount, c.paymentMethod, c.accountSuffix, c.counterparty], ['debit', 2499, 'Debit Card', '4321', 'AMAZON']);
});

test('4. ATM withdrawal', () => {
  const c = txn(classifySms(sms('Rs.5000 withdrawn at ATM from A/c XX1234 on 05-10-26. Avl bal Rs 12,000.')));
  assert.equal(c.kind, 'debit');
  assert.equal(c.isAtmWithdrawal, true);
  assert.equal(c.paymentMethod, undefined, 'unknown methods stay unknown');
});

test('5. transfer between own accounts is skipped (never counted as income or expense)', () => {
  assert.equal(ignoredReason(classifySms(sms('Rs 10,000 transferred from A/c XX1234 to your own A/c XX9876 (self transfer) on 05-10-26.'))), 'self_transfer');
});

test('6. refund imports as a refund', () => {
  const c = txn(classifySms(sms('Refund of Rs 499.00 from AMAZON has been credited to your A/c XX1234 on 05-10-26. Ref 712345678901')));
  assert.equal(c.kind, 'refund');
  assert.equal(c.amount, 499);
});

test('7. reversal imports as a refund', () => {
  const c = txn(classifySms(sms('Txn of Rs 300.00 on A/c XX1234 has been reversed on 05-10-26. UPI Ref 612345678903')));
  assert.equal(c.kind, 'refund');
});

test('"transferred to your A/c" is money in', () => {
  assert.equal(txn(classifySms(sms('Rs 2,000 transferred to your A/c XX1234 from RAVI via IMPS on 05-10-26. IMPS Ref No 512345678901'))).kind, 'credit');
});

// ---- Parser: exclusions -------------------------------------------------------------

test('8. OTP (even with an amount) is excluded; a "never share OTP" footer is not mistaken for one', () => {
  assert.equal(ignoredReason(classifySms(sms('123456 is your OTP for txn of Rs 2,000 at AMAZON. Valid for 5 mins. Do not share.'))), 'otp');
  assert.equal(ignoredReason(classifySms(sms('OTP for login is 9876. Never share it.'))), 'otp');
  assert.equal(classifySms(sms('Rs 100 debited from A/c XX1234 on 05-10-26 to VPA a@ybl. UPI Ref 612345678904. Never share your OTP with anyone.')).status, 'transaction');
});

test('9. promotional SMS is excluded', () => {
  assert.equal(ignoredReason(classifySms(sms('Congratulations! You are eligible for a pre-approved personal loan of Rs 5,00,000. Apply now. T&C apply'))), 'promotion');
});

test('10. balance-only notification is excluded, including "balance … after debit of" restatements', () => {
  assert.equal(ignoredReason(classifySms(sms('Your A/c XX1234 available balance is Rs 12,345.67 as on 05-10-26.'))), 'balance_only');
  assert.equal(ignoredReason(classifySms(sms('Avl Bal in A/c XX1234 is Rs 9,800 after debit of Rs 200 on 05-10-26.'))), 'balance_only');
});

test('11. failed payment is excluded', () => {
  assert.equal(ignoredReason(classifySms(sms('Your UPI payment of Rs 450 to zomato@ybl has failed. Amount if debited will be refunded.'))), 'failed');
});

test('12. pending payment is excluded', () => {
  assert.equal(ignoredReason(classifySms(sms('Your payment of Rs 1,200 to ELECTRICITY BOARD is pending. Ref 612345678905'))), 'pending');
});

test('13. an amount without evidence of a completed transaction is excluded', () => {
  assert.equal(ignoredReason(classifySms(sms('Your credit card bill of Rs 8,450 is due on 15-10-26. Pay now to avoid charges.'))), 'reminder');
  assert.equal(ignoredReason(classifySms(sms('Price drop! iPhone now at Rs 59,999 only.'))), 'promotion');
  assert.equal(ignoredReason(classifySms(sms('Rs 500 request from ravi@ybl. Approve in your UPI app.'))), 'no_transaction');
  assert.equal(ignoredReason(classifySms(sms('Your login to net banking was successful.'))), 'security');
});

test('14. malformed amount is not imported', () => {
  assert.equal(ignoredReason(classifySms(sms('Rs 1.2.3 debited from A/c XX1234 on 05-10-26.'))), 'invalid_amount');
  assert.equal(parseAmount('1,25,000.50'), 125000.5);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('12,,00'), null);
});

test('15. missing recipient stays missing (not invented)', () => {
  const c = txn(classifySms(sms('Rs 750.00 debited from A/c XX1234 on 05-10-26. UPI Ref 612345678906.')));
  assert.equal(c.counterparty, undefined);
});

test('16. missing date in the text uses the phone receive date and time', () => {
  const c = txn(classifySms(sms('Rs 120 debited from A/c XX1234 to VPA tea@ybl. UPI Ref 612345678907', '2026-10-07T08:05:00')));
  assert.equal(c.date, '2026-10-07');
  assert.equal(c.time, '08:05');
});

test('no account / card / UPI reference → review, not auto-import; promo words + transaction → review', () => {
  assert.deepEqual(statusAndReason(classifySms(sms('You paid Rs 300 at CAFE on 05-10-26.'))), ['review', 'no_account_reference']);
  assert.deepEqual(statusAndReason(classifySms(sms('Rs 50 cashback credited to A/c XX1234. Exclusive offer: win up to Rs 500!'))), ['review', 'promotion_with_transaction']);
});

function statusAndReason(c: SmsClassification) {
  return [c.status, c.status === 'review' ? c.reason : (c as { reason?: string }).reason];
}

// ---- Dedup --------------------------------------------------------------------------

test('17. duplicate reference → same import key even from a different message', () => {
  const a = sms('Rs 250 debited from A/c XX1234 on 05-10-26 to VPA x@ybl. UPI Ref 612345678908', '2026-10-05T10:00:00');
  const b = sms('Rs 250 debited from A/c XX1234 on 05-10-26 to VPA x@ybl. UPI Ref 612345678908', '2026-10-05T10:03:00', 'AD-SYNBNK');
  assert.equal(importKey(txn(classifySms(a)), a), importKey(txn(classifySms(b)), b));
  assert.notEqual(messageKey(a), messageKey(b));
});

test('18. two genuine same-amount payments to the same payee stay separate', () => {
  const a = sms('Rs 40 debited from A/c XX1234 on 05-10-26 to VPA tea@ybl', '2026-10-05T10:00:00');
  const b = sms('Rs 40 debited from A/c XX1234 on 05-10-26 to VPA tea@ybl', '2026-10-05T16:00:00');
  assert.notEqual(importKey(txn(classifySms(a)), a), importKey(txn(classifySms(b)), b));
});

test('manual entry that matches → flagged as likely existing', () => {
  const c = txn(classifySms(sms('Rs 1,250 spent on Credit Card ending 9999 at CROMA on 05-10-26.')));
  const manual = { type: 'expense', amount: 1250, date: '2026-10-06' } as Transaction;
  assert.ok(findLikelyExisting(c, [manual]));
  assert.equal(findLikelyExisting(c, [{ ...manual, amount: 1251 }]), undefined);
});

// ---- Date ranges ----------------------------------------------------------------------

test('22. current month / last 2 / last 3 use local calendar month starts (incl. year boundary)', () => {
  const now = new Date(2026, 9, 11, 15, 0); // 11 Oct 2026
  assert.deepEqual([1, 2, 3].map((m) => historyPeriodStart(now, m as 1 | 2 | 3).toDateString()), [
    new Date(2026, 9, 1).toDateString(),
    new Date(2026, 8, 1).toDateString(),
    new Date(2026, 7, 1).toDateString(),
  ]);
  assert.equal(historyPeriodStart(new Date(2027, 0, 3), 3).toDateString(), new Date(2026, 10, 1).toDateString());
});

test('plan: initial, incremental with overlap, back-fill when the period grows, future checkpoint clamped', () => {
  const now = at('2026-10-11T12:00:00');
  const fresh: SmsImportState = { ...defaultSmsImportState(), enabled: true, onboarded: true };
  assert.deepEqual(planSmsScan(fresh, now), { from: new Date(2026, 9, 1).getTime(), to: now, kind: 'initial' });

  const scanned = { ...fresh, coveredFrom: new Date(2026, 9, 1).getTime(), lastSuccessfulSmsScanAt: at('2026-10-10T12:00:00') };
  assert.deepEqual(planSmsScan(scanned, now), { from: at('2026-10-10T12:00:00') - SMS_SCAN_OVERLAP_MS, to: now, kind: 'incremental' });
  assert.equal(planSmsScan({ ...scanned, historyMonths: 3 }, now).kind, 'backfill');
  assert.equal(planSmsScan({ ...scanned, historyMonths: 3 }, now).from, new Date(2026, 7, 1).getTime());

  const clockBack = planSmsScan({ ...scanned, lastSuccessfulSmsScanAt: at('2026-12-01T00:00:00') }, now);
  assert.equal(clockBack.from, now - SMS_SCAN_OVERLAP_MS);

  assert.equal(shouldAutoScan({ ...scanned, lastScanAttemptAt: now - 60_000 }, now), false, 'reopened within 10 minutes');
  assert.equal(shouldAutoScan({ ...scanned, lastScanAttemptAt: now - 11 * 60_000 }, now), true);
  assert.equal(shouldAutoScan({ ...scanned, enabled: false }, now), false);
});

// ---- Engine ------------------------------------------------------------------------------

class MemoryStore implements SmsImportStore {
  state: SmsImportState = { ...defaultSmsImportState(), enabled: true, onboarded: true };
  records = new Map<string, SmsMessageRecord>();
  transactions: Transaction[] = [];
  failNextCommit = false;
  commits = 0;

  async getState() { return structuredClone(this.state); }
  async saveState(s: SmsImportState) { this.state = structuredClone(s); }
  async getMessageRecords(keys: string[]) {
    return new Map(keys.filter((k) => this.records.has(k)).map((k) => [k, structuredClone(this.records.get(k)!)]));
  }
  async existingImportKeys(keys: string[]) {
    const all = new Set(this.transactions.map((t) => t.importKey));
    return new Set(keys.filter((k) => all.has(k)));
  }
  async transactionsBetween(from: string, to: string) {
    return this.transactions.filter((t) => t.date >= from && t.date <= to);
  }
  async commit(batch: { transactions: Transaction[]; records: SmsMessageRecord[]; state?: SmsImportState }) {
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error('disk full');
    }
    this.commits++;
    this.transactions.push(...batch.transactions);
    batch.records.forEach((r) => this.records.set(r.messageKey, r));
    if (batch.state) this.state = structuredClone(batch.state);
  }
  async pruneRecords(olderThan: number) {
    let n = 0;
    for (const [k, r] of this.records) if (r.smsDate < olderThan && r.status !== 'review') (this.records.delete(k), n++);
    return n;
  }
  async reviewRecords() { return [...this.records.values()].filter((r) => r.status === 'review'); }
}

class FakeInbox implements SmsInbox {
  messages: RawSms[] = [];
  permission: SmsPermission = 'granted';
  available = true;
  queries: { from: number; to: number }[] = [];
  delay = 0;
  isAvailable() { return this.available; }
  async checkPermission() { return this.permission; }
  async requestPermission() { return this.permission; }
  async query({ from, to, offset, limit }: { from: number; to: number; offset: number; limit: number }) {
    this.queries.push({ from, to });
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay));
    return this.messages.filter((m) => m.date >= from && m.date <= to).sort((a, b) => a.date - b.date).slice(offset, offset + limit);
  }
}

const INBOX = [
  sms('Rs.250.00 debited from A/c XX1234 on 03-10-26 to VPA swiggy@ybl (UPI Ref No 612345670001).', '2026-10-03T13:00:00'),
  sms('INR 85,000.00 credited to A/c XX1234 on 01-10-26 by NEFT from ACME PVT LTD. Avl Bal INR 1,00,000', '2026-10-01T09:00:00'),
  sms('123456 is your OTP for txn of Rs 2,000. Do not share.', '2026-10-02T10:00:00'),
  sms('Get a pre-approved loan of Rs 5,00,000. Apply now!', '2026-10-02T11:00:00'),
  sms('You paid Rs 300 at CAFE on 04-10-26.', '2026-10-04T18:00:00'),
  sms('Rs 999 spent on Credit Card ending 9999 at MYNTRA on 20-08-26.', '2026-08-20T12:00:00'),
];

function setup(nowIso = '2026-10-11T12:00:00') {
  const store = new MemoryStore();
  const inbox = new FakeInbox();
  inbox.messages = [...INBOX];
  let now = at(nowIso);
  let id = 0;
  const engine = new SmsImportEngine(inbox, store, () => now, () => `t${++id}`);
  return { store, inbox, engine, setNow: (iso: string) => (now = at(iso)) };
}

test('23. initial import (current month) then incremental: only new messages, checkpoint advances', async () => {
  const { store, inbox, engine, setNow } = setup();

  const first = await engine.scan();
  assert.equal(first.status, 'success');
  assert.deepEqual(store.transactions.map((t) => [t.type, t.amount, t.category, t.source]), [
    ['income', 85000, 'Other', 'sms'],
    ['expense', 250, 'Food', 'sms'],
  ]);
  assert.equal(store.state.lastSuccessfulSmsScanAt, at('2026-10-11T12:00:00'));
  assert.equal((await store.reviewRecords()).length, 1, 'the CAFE payment awaits review');
  assert.ok(!store.transactions.some((t) => t.amount === 999), 'August is outside "current month"');
  assert.ok(!JSON.stringify([...store.records.values()]).match(/debited|OTP|swiggy@ybl \(/), 'no raw message text stored');

  setNow('2026-10-12T09:00:00');
  inbox.messages.push(sms('Rs 60 debited from A/c XX1234 on 12-10-26 to VPA metro@ybl. UPI Ref 612345670002', '2026-10-12T08:30:00'));
  const second = await engine.scan();
  assert.equal(second.status === 'success' && second.window.kind, 'incremental');
  assert.equal(inbox.queries.at(-1)!.from, at('2026-10-11T12:00:00') - SMS_SCAN_OVERLAP_MS);
  assert.equal(store.transactions.length, 3);
  assert.equal(store.transactions.at(-1)!.category, 'Transportation');
});

test('19. overlapping scans never import twice', async () => {
  const { store, engine, setNow } = setup();
  await engine.scan();
  setNow('2026-10-11T12:30:00');
  const again = await engine.scan();
  assert.equal(again.status === 'success' && again.summary.imported, 0);
  assert.equal(store.transactions.length, 2);
});

test('24. reopening with no new messages finishes normally', async () => {
  const { engine, setNow } = setup();
  await engine.scan();
  setNow('2026-10-11T13:00:00');
  const r = await engine.scan();
  assert.equal(r.status, 'success');
  assert.deepEqual(r.status === 'success' && [r.summary.imported, r.summary.awaitingReview], [0, 0]);
});

test('history period grows to 3 months → back-fill imports August without duplicating October', async () => {
  const { store, engine, setNow } = setup();
  await engine.scan();
  store.state.historyMonths = 3;
  setNow('2026-10-11T12:30:00');
  const r = await engine.scan();
  assert.equal(r.status === 'success' && r.window.kind, 'backfill');
  assert.deepEqual(store.transactions.map((t) => t.amount).sort((a, b) => a - b), [250, 999, 85000]);
  assert.equal(store.state.coveredFrom, new Date(2026, 7, 1).getTime());
});

test('20. interrupted scan (storage failure) writes nothing and resumes from the old checkpoint', async () => {
  const { store, engine } = setup();
  store.failNextCommit = true;

  assert.equal((await engine.scan()).status, 'failed');
  assert.equal(store.transactions.length, 0);
  assert.equal(store.state.lastSuccessfulSmsScanAt, null, 'checkpoint not advanced');
  assert.equal(store.state.lastScanStatus, 'failed');

  const retry = await engine.scan();
  assert.equal(retry.status === 'success' && retry.window.kind, 'initial');
  assert.equal(store.transactions.length, 2);
});

test('cancelled scan writes nothing', async () => {
  const { store, engine } = setup();
  const controller = new AbortController();
  controller.abort();
  assert.equal((await engine.scan({ signal: controller.signal })).status, 'cancelled');
  assert.equal(store.commits, 0);
});

test('21. permission revoked → status recorded, nothing read, checkpoint unchanged', async () => {
  const { store, inbox, engine } = setup();
  inbox.permission = 'denied';
  assert.equal((await engine.scan()).status, 'permission_denied');
  assert.equal(inbox.queries.length, 0);
  assert.equal(store.state.lastSuccessfulSmsScanAt, null);
  assert.equal(store.state.lastScanStatus, 'permission_denied');
});

test('unsupported environment (no native SMS plugin) → unavailable, nothing read', async () => {
  const { inbox, engine } = setup();
  inbox.available = false;
  assert.equal((await engine.scan()).status, 'unavailable');
  assert.equal(inbox.queries.length, 0);
});

test('concurrent scans share one run (no double import)', async () => {
  const { store, inbox, engine } = setup();
  inbox.delay = 10;
  const [a, b] = await Promise.all([engine.scan(), engine.scan()]);
  assert.equal(a, b);
  assert.equal(store.transactions.length, 2);
  assert.equal(store.commits, 1);
});

test('disabled or not set up → no scan; app-open scan respects the 10-minute throttle', async () => {
  const { store, inbox, engine } = setup();
  store.state.enabled = false;
  assert.deepEqual(await engine.scan(), { status: 'skipped', reason: 'disabled' });
  store.state = { ...store.state, enabled: true, lastScanAttemptAt: at('2026-10-11T11:55:00') };
  assert.deepEqual(await engine.scan({ auto: true }), { status: 'skipped', reason: 'too_soon' });
  assert.equal(inbox.queries.length, 0);
});

test('manual entry for the same payment → review instead of a second copy', async () => {
  const { store, engine } = setup();
  store.transactions.push({ id: 'm1', type: 'expense', amount: 250, category: 'Food', date: '2026-10-03', description: 'Lunch', createdAt: '', updatedAt: '' });
  await engine.scan();
  assert.equal(store.transactions.filter((t) => t.amount === 250).length, 1);
  assert.ok((await store.reviewRecords()).some((r) => r.reviewReason === 'possible_manual_duplicate'));
});

test('review: confirm (edited) imports once; reject is never shown again', async () => {
  const { store, engine, setNow } = setup();
  await engine.scan();
  const [review] = await store.reviewRecords();

  const tx = await engine.confirmReview(review.messageKey, { ...review.candidate!, amount: 320 });
  assert.equal(tx?.amount, 320);
  assert.equal(await engine.confirmReview(review.messageKey, review.candidate!), null, 'cannot import twice');

  store.records.set('m:x', { messageKey: 'm:x', status: 'review', smsDate: at('2026-10-04T00:00:00'), candidate: review.candidate, updatedAt: 0 });
  await engine.rejectReview('m:x');
  assert.equal(store.records.get('m:x')!.status, 'rejected');
  assert.equal(store.records.get('m:x')!.candidate, undefined, 'rejected items keep no extracted data');

  setNow('2026-10-11T13:00:00');
  await engine.scan();
  assert.equal((await store.reviewRecords()).length, 0, 'nothing comes back after rescanning');
});

test('retention: old metadata is pruned, transactions are never deleted', async () => {
  const { store, engine, setNow } = setup();
  await engine.scan();
  const before = store.transactions.length;
  store.records.set('m:old', { messageKey: 'm:old', status: 'rejected', smsDate: at('2025-01-01T00:00:00'), updatedAt: 0 });
  setNow('2026-10-11T13:00:00');
  await engine.scan();
  assert.equal(store.records.has('m:old'), false);
  assert.equal(store.transactions.length, before);
});

test('25. AI unavailable: import works (no AI involved) and the AI context never contains SMS details', async () => {
  const { store, engine } = setup();
  assert.equal((await engine.scan()).status, 'success');

  const context = JSON.stringify(
    buildFinancialContext({ transactions: store.transactions, currencyCode: 'INR', currencySymbol: '₹', now: new Date(2026, 9, 11) }),
  );
  assert.ok(context.includes('85000'), 'totals are present');
  for (const secret of ['1234', '612345670001', 'swiggy@ybl', 'ACME', 'A/c', 'Ref']) {
    assert.ok(!context.includes(secret), `AI context must not contain ${secret}`);
  }
});
