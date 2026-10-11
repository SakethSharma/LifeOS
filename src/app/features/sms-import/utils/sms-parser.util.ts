/**
 * Deterministic, rule-based classification of bank / UPI / card SMS. Runs
 * entirely on the device; no AI. The rules prefer skipping (or asking for
 * review) over importing something that might be wrong:
 *
 *   1. Exclusions first: OTPs, failed / pending / declined, reminders and
 *      requests, security alerts, promotions, balance-only notices.
 *   2. A transaction needs a completed money-movement word (debited,
 *      credited, spent, paid, withdrawn, received, refunded, reversed…) AND a
 *      valid amount that isn't a balance or limit.
 *   3. It's imported automatically only when it's also tied to an account,
 *      card or UPI/bank reference; otherwise it goes to review.
 */
import type {
  RawSms,
  SmsClassification,
  SmsPaymentMethod,
  SmsSkipReason,
  SmsTransactionCandidate,
  SmsTransactionKind,
} from '../models/sms-import.model';

const MAX_AMOUNT = 1_000_000_000;

// ---- Exclusions --------------------------------------------------------------

/** An actual one-time code being delivered (not a "never share your OTP" footer). */
const OTP_PATTERNS = [
  /\b(otp|one[\s-]?time[\s-]?pass(word|code)?|verification code|security code|auth(entication)? code)\b[^.\d]{0,40}?\b\d{4,8}\b/i,
  /\b\d{4,8}\b[^.]{0,30}\b(is|as) (your|the) (otp|one[\s-]?time[\s-]?pass(word|code)?|verification code)\b/i,
];

const FAILED = /\b(failed|failure|declined|unsuccessful|was not successful|could not be (processed|completed)|not processed|rejected|insufficient (funds|balance)|has been cancelled|is cancelled|txn cancelled)\b/i;

const PENDING = /\b(pending|initiated|is being processed|under process|in process|will be (debited|credited|deducted|processed)|scheduled for|awaiting)\b/i;

const REMINDER =
  /\b(is due|due (on|date|by)|payment due|min(imum)?\.? amount due|total amount due|reminder|has requested|requested (money|payment|rs|inr)|collect request|pay now|bill (is )?generated|statement (is )?generated|e-?mandate|auto-?pay (is )?(set|scheduled)|will be auto)/i;

const SECURITY =
  /\b(log(ged)?[\s-]?in|login|password|m-?pin|upi pin|new device|device (binding|registration)|registered (successfully|mobile)|beneficiary (added|registered)|card (is )?(blocked|activated|deactivated))\b/i;

const PROMOTION =
  /\b(offer|cashback (of )?up ?to|win|won|congratulations|pre-?approved|eligible for|apply now|limited period|discount|voucher|coupon|click here|t ?& ?c apply|loan (of|up ?to|at)|get up ?to|instant loan|personal loan|credit limit (increase|enhanced)|upgrade your|exclusive|hurry|last day|price drop|sale|deal|buy now|shop now|now at|only for you)\b/i;

const BALANCE = /\b(avl|avbl|available|closing|clear|ledger|total|current)\.?\s*(bal|balance)\b|\bbal(ance)?\s*(is|:|in your|as on)\b/i;

const SELF_TRANSFER = /\b(self[\s-]?transfer|to (your )?own (a\/?c|acc(ount)?)|between your (own )?accounts|transfer to self|to self\b)/i;

// ---- Evidence of a completed transaction ------------------------------------

const DEBIT = /\b(debited|spent|paid|withdrawn|sent|transferred|deducted|purchase(d)? of|used (at|for)|debit of|txn of)\b/i;
const CREDIT = /\b(credited|received|deposited|credit of|added to your|(transferred|sent) to your (a\/?c|acc(oun)?t))\b/i;
const REFUND = /\b(refund(ed)?|reversed|reversal|credited back|chargeback)\b/i;

/** Ties a message to the user's account / card / UPI — required for automatic import. */
const ACCOUNT_REF = /\b(a\/?c|acct|account|card|upi|vpa|imps|neft|rtgs)\b/i;

/** Rs / INR / ₹ followed by a number (Indian or international digit grouping). */
const AMOUNT = /(?:\brs\.?|\binr\.?|₹)\s*([0-9][0-9,.]*)/gi;

/** Words that mean the amount right after is a balance or limit, not the transaction. */
const NOT_TXN_AMOUNT_BEFORE = /(bal(ance)?|limit|lmt|avl|avbl|available|due|outstanding)[^0-9a-z]{0,6}[a-z.: ]{0,8}$/i;

export function classifySms(sms: RawSms): SmsClassification {
  const body = normalizeWhitespace(sms.body ?? '');

  if (!body) return ignored('not_financial');

  // 1. Exclusions — checked before anything that looks like a transaction.
  if (OTP_PATTERNS.some((p) => p.test(body))) return ignored('otp');
  if (FAILED.test(body)) return ignored('failed');
  if (PENDING.test(body)) return ignored('pending');
  if (REMINDER.test(body)) return ignored('reminder');

  const isRefund = REFUND.test(body);
  const debitAt = firstIndex(DEBIT, body);
  const creditAt = firstIndex(CREDIT, body);
  const hasMovement = isRefund || debitAt >= 0 || creditAt >= 0;

  if (!hasMovement) {
    if (SECURITY.test(body)) return ignored('security');
    if (PROMOTION.test(body)) return ignored('promotion');
    if (BALANCE.test(body)) return ignored('balance_only');
    return ignored(AMOUNT_TEST.test(body) ? 'no_transaction' : 'not_financial');
  }

  if (SELF_TRANSFER.test(body)) return ignored('self_transfer');

  // "Balance in A/c XX12 is Rs 5,000 after debit of Rs 200" restates an earlier
  // transaction (already imported from its own message): not a new one.
  const balanceAt = firstIndex(BALANCE, body);
  const movementAt = Math.min(...[debitAt, creditAt, firstIndex(REFUND, body)].filter((i) => i >= 0));
  if (balanceAt >= 0 && balanceAt < movementAt) return ignored('balance_only');

  // 2. Amount: exactly one transaction amount (balances and limits don't count).
  const amounts = transactionAmounts(body);
  if (amounts.invalid) return ignored('invalid_amount');
  if (amounts.values.length === 0) return ignored('no_transaction');

  const kind: SmsTransactionKind = isRefund ? 'refund' : direction(debitAt, creditAt);
  const date = transactionDateTime(body, sms.date);
  if (!date) return ignored('no_date');

  const candidate: SmsTransactionCandidate = {
    kind,
    amount: amounts.values[0],
    date: date.date,
    ...(date.time ? { time: date.time } : {}),
    ...optional('accountSuffix', accountSuffix(body)),
    ...optional('counterparty', counterparty(body, kind)),
    ...optional('paymentMethod', paymentMethod(body)),
    ...optional('reference', reference(body)),
    ...(/\batm\b|cash withdrawal/i.test(body) ? { isAtmWithdrawal: true } : {}),
    ...optional('senderLabel', senderLabel(sms.address)),
  };

  // 3. Confidence: anything uncertain goes to review instead of being imported.
  if (PROMOTION.test(body)) return { status: 'review', candidate, reason: 'promotion_with_transaction' };
  if (new Set(amounts.values).size > 1) return { status: 'review', candidate, reason: 'multiple_amounts' };
  if (!isRefund && debitAt >= 0 && creditAt >= 0 && debitAt !== creditAt && !isDebitNotice(body)) {
    return { status: 'review', candidate, reason: 'ambiguous_direction' };
  }
  if (!ACCOUNT_REF.test(body) && !candidate.reference) return { status: 'review', candidate, reason: 'no_account_reference' };

  return { status: 'transaction', candidate };
}

const AMOUNT_TEST = /(?:\brs\.?|\binr\.?|₹)\s*[0-9]/i;

function ignored(reason: SmsSkipReason): SmsClassification {
  return { status: 'ignored', reason };
}

function direction(debitAt: number, creditAt: number): SmsTransactionKind {
  // Equal positions: "transferred to your A/c" matched both — it's money in.
  if (debitAt >= 0 && (creditAt < 0 || debitAt < creditAt)) return 'debit';
  return 'credit';
}

/**
 * Debit notices often name the payee as "credited" too, e.g. "Acct XX12
 * debited for Rs 250; JOHN credited." or "debited … and credited to VPA x@y".
 * When "debited" comes first and the credit refers to the other party, it's a
 * plain debit.
 */
function isDebitNotice(body: string): boolean {
  const debitAt = firstIndex(DEBIT, body);
  const creditAt = firstIndex(CREDIT, body);
  if (debitAt < 0 || creditAt < 0 || debitAt > creditAt) return false;

  const creditPart = body.slice(creditAt - 40 < 0 ? 0 : creditAt - 40, creditAt + 40).toLowerCase();
  return /;\s*[a-z0-9 .&'-]{1,40}\s+credited|credited to (vpa|beneficiary|a\/?c of|[a-z0-9._-]+@)|\band credited to\b/i.test(creditPart) ||
    /;\s*[a-z0-9 .&'-]{1,40}credited/i.test(body.slice(debitAt));
}

function transactionAmounts(body: string): { values: number[]; invalid: boolean } {
  const values: number[] = [];
  let invalid = false;
  AMOUNT.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = AMOUNT.exec(body)) !== null) {
    const before = body.slice(Math.max(0, match.index - 24), match.index);
    if (NOT_TXN_AMOUNT_BEFORE.test(before)) continue;

    const amount = parseAmount(match[1]);
    if (amount === null) {
      invalid = true;
      continue;
    }
    values.push(amount);
  }

  return { values, invalid: invalid && values.length === 0 };
}

/** "1,25,000.50" → 125000.5. Rejects malformed numbers like "1.2.3" or "12,,00". */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/,(?=\d)/g, '').replace(/\.$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned) || /,,/.test(text)) return null;

  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 && value < MAX_AMOUNT ? Math.round(value * 100) / 100 : null;
}

// ---- Fields ------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The transaction date: the date written in the message when it's plausible
 * (within 45 days before, and not after, the receive time), otherwise the
 * phone's receive date. Time comes from the receive time.
 */
export function transactionDateTime(body: string, receivedAt: number): { date: string; time?: string } | null {
  const received = Number.isFinite(receivedAt) && receivedAt > 0 ? new Date(receivedAt) : null;
  const stated = statedDate(body);

  if (stated && received) {
    const diffDays = (startOfDay(received).getTime() - stated.getTime()) / 86_400_000;
    if (diffDays >= 0 && diffDays <= 45) {
      return { date: ymd(stated), ...(diffDays === 0 ? { time: hm(received) } : {}) };
    }
  }

  if (received) return { date: ymd(received), time: hm(received) };
  return stated ? { date: ymd(stated) } : null;
}

function statedDate(body: string): Date | null {
  const patterns: RegExp[] = [
    /\b(\d{1,2})[-/. ]([A-Za-z]{3})[a-z]*[-/., ]+(\d{2,4})\b/, // 05-Oct-26, 5 Oct 2026
    /\b(\d{1,2})([A-Za-z]{3})(\d{2,4})\b/, // 05Oct26
    /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/, // 05-10-26, 05/10/2026
    /\b(\d{4})-(\d{2})-(\d{2})\b/, // 2026-10-05
  ];

  for (const pattern of patterns) {
    const m = pattern.exec(body);
    if (!m) continue;

    let day: number;
    let month: number;
    let year: number;

    if (pattern === patterns[3]) {
      year = Number(m[1]);
      month = Number(m[2]) - 1;
      day = Number(m[3]);
    } else {
      day = Number(m[1]);
      month = /^\d+$/.test(m[2]) ? Number(m[2]) - 1 : MONTHS.indexOf(m[2].toLowerCase().slice(0, 3));
      year = Number(m[3]);
      if (year < 100) year += 2000;
    }

    const date = new Date(year, month, day);
    if (month >= 0 && month < 12 && date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
      return date;
    }
  }

  return null;
}

function accountSuffix(body: string): string | undefined {
  const m = /\b(?:a\/?c|acct|account|card)(?:\s*(?:no\.?|number|ending(?:\s*(?:in|with))?|is))*[\s:.-]*[x*#]*\s*(\d{3,6})\b/i.exec(body);
  return m ? m[1].slice(-4) : undefined;
}

function paymentMethod(body: string): SmsPaymentMethod | undefined {
  if (/\bupi\b|\bvpa\b|@[a-z]{2,}\b/i.test(body)) return 'UPI';
  if (/credit card|\bcc\b/i.test(body)) return 'Credit Card';
  if (/debit card/i.test(body)) return 'Debit Card';
  if (/\b(neft|imps|rtgs)\b/i.test(body)) return 'Bank Transfer';
  return undefined;
}

function reference(body: string): string | undefined {
  const m =
    /\b(?:upi\s*(?:ref(?:erence)?\.?\s*(?:no\.?|id)?)?|ref(?:erence)?\.?\s*(?:no\.?|number|id)?|utr\s*(?:no\.?)?|rrn|txn\s*(?:id|no)\.?|imps\s*ref\.?\s*(?:no\.?)?)\s*[:#-]?\s*([A-Za-z0-9]{6,22})\b/i.exec(body);
  return m && /\d{6,}/.test(m[1]) ? m[1].toUpperCase() : undefined;
}

const COUNTERPARTY_STOP = /^(your|a\/?c|ac|acct|account|card|the|on|you|rs|inr|bank)\b/i;

function counterparty(body: string, kind: SmsTransactionKind): string | undefined {
  const lead = kind === 'debit' ? '(?:to|at|towards|paid to|for)' : '(?:from|by)';
  const re = new RegExp(
    `\\b${lead}\\s+(?:(?:neft|imps|rtgs|upi)\\s+(?:from\\s+|by\\s+)?)?(?:vpa\\s+|merchant\\s+)?([A-Za-z0-9][A-Za-z0-9 .&'@_-]{1,40}?)(?=\\s+(?:on|ref|upi|via|thru|through|using|avl|is|was|for|dated|at|-)\\b|[.(;,]|$)`,
    'i',
  );
  const m = re.exec(body);
  if (!m) return undefined;

  const name = m[1].trim().replace(/[.\s]+$/, '');
  if (!name || COUNTERPARTY_STOP.test(name) || /^\d+$/.test(name) || /^x+\d+$/i.test(name)) return undefined;
  return name.slice(0, 40);
}

function senderLabel(address: string): string | undefined {
  const m = /^[A-Z]{2}-([A-Z0-9]{3,9})(?:-[A-Z])?$/i.exec((address ?? '').trim());
  return m ? m[1].toUpperCase() : undefined;
}

// ---- Helpers ------------------------------------------------------------------

function firstIndex(re: RegExp, text: string): number {
  const m = re.exec(text);
  return m ? m.index : -1;
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
