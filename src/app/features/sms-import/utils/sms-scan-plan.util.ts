/**
 * Which time window an SMS scan reads, from the saved checkpoint. Pure and
 * clock-injected so every boundary is testable.
 */
import type { SmsHistoryMonths, SmsImportState } from '../models/sms-import.model';

/** Re-read this much before the last checkpoint: late-delivered SMS and timestamp edges. */
export const SMS_SCAN_OVERLAP_MS = 24 * 60 * 60 * 1000;

/** App-open scans closer together than this are skipped (manual "Scan now" ignores it). */
export const SMS_AUTO_SCAN_MIN_INTERVAL_MS = 10 * 60 * 1000;

export interface SmsScanWindow {
  from: number;
  to: number;
  kind: 'initial' | 'incremental' | 'backfill';
}

/**
 * Start of the history period in the phone's local calendar:
 * 1 = 1st of this month, 2 = 1st of last month, 3 = 1st of the month before.
 */
export function historyPeriodStart(now: Date, months: SmsHistoryMonths): Date {
  return new Date(now.getFullYear(), now.getMonth() - (months - 1), 1, 0, 0, 0, 0);
}

/**
 * - First scan: the whole chosen period, up to now.
 * - A longer period chosen later: from the new period start (back-fill),
 *   overlapping what was already read; duplicates are filtered out.
 * - Otherwise: from the last successful scan (minus the overlap) up to now.
 *
 * Clock changes: a checkpoint in the future (clock moved back) is clamped to
 * now, so new messages are never skipped.
 */
export function planSmsScan(state: SmsImportState, nowMs: number): SmsScanWindow {
  const now = new Date(nowMs);
  const periodStart = historyPeriodStart(now, state.historyMonths).getTime();
  const last = state.lastSuccessfulSmsScanAt;

  if (last === null || !Number.isFinite(last) || state.coveredFrom === null) {
    return { from: periodStart, to: nowMs, kind: 'initial' };
  }

  if (periodStart < state.coveredFrom) {
    return { from: periodStart, to: nowMs, kind: 'backfill' };
  }

  const checkpoint = Math.min(last, nowMs);
  return { from: Math.max(0, checkpoint - SMS_SCAN_OVERLAP_MS), to: nowMs, kind: 'incremental' };
}

/** Whether an app-open scan should run now (not too soon after the last attempt). */
export function shouldAutoScan(state: SmsImportState, nowMs: number): boolean {
  if (!state.enabled || !state.onboarded) return false;
  const lastAttempt = state.lastScanAttemptAt;
  if (lastAttempt === null || lastAttempt > nowMs) return true;
  return nowMs - lastAttempt >= SMS_AUTO_SCAN_MIN_INTERVAL_MS;
}
