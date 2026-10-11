import { Injectable, computed, inject, signal } from '@angular/core';
import { App as CapacitorApp } from '@capacitor/app';
import { TransactionService } from '../../../core/services/transaction.service';
import { SmsImportEngine } from '../engine/sms-import.engine';
import type { SmsPermission, SmsScanOutcome, SmsScanProgress } from '../engine/sms-import.engine';
import { defaultSmsImportState } from '../models/sms-import.model';
import type { SmsHistoryMonths, SmsImportState, SmsMessageRecord, SmsTransactionCandidate } from '../models/sms-import.model';
import { DexieSmsImportStore } from './sms-import.store';
import { NativeSmsInbox } from './sms-inbox.native';

/**
 * The SMS importer for the app: state for the Settings card, a scan when the
 * app opens or returns to the foreground (at most every 10 minutes, and only
 * once the user has turned it on), and the review actions. Everything runs on
 * this phone; nothing here uses AI or the network.
 */
@Injectable({ providedIn: 'root' })
export class SmsImportService {
  private transactions = inject(TransactionService);
  private inbox = new NativeSmsInbox();
  private store = new DexieSmsImportStore();
  private engine = new SmsImportEngine(this.inbox, this.store);
  private resumeListening = false;

  /** False in a browser / PWA: SMS can only be read by the Android app. */
  readonly available = this.inbox.isAvailable();

  readonly state = signal<SmsImportState>(defaultSmsImportState());
  readonly permission = signal<SmsPermission>('prompt');
  readonly scanning = signal(false);
  readonly progress = signal<SmsScanProgress | null>(null);
  readonly lastOutcome = signal<SmsScanOutcome | null>(null);
  readonly reviewItems = signal<SmsMessageRecord[]>([]);
  readonly reviewCount = computed(() => this.reviewItems().length);

  /** Loads saved state; called once at app start. Never reads messages by itself. */
  async init(): Promise<void> {
    await this.refreshState();
    if (!this.available) return;

    this.permission.set(await this.inbox.checkPermission().catch(() => 'denied' as const));

    if (!this.resumeListening) {
      this.resumeListening = true;
      void CapacitorApp.addListener('resume', () => void this.scanOnAppOpen());
    }
  }

  /** App opened or resumed: a scan only if enabled, permitted and not run in the last 10 minutes. */
  async scanOnAppOpen(): Promise<void> {
    if (!this.available || !this.state().enabled) return;
    await this.runScan(true);
  }

  /** "Scan messages now". */
  scanNow(): Promise<void> {
    return this.runScan(false);
  }

  /**
   * First-time setup: the user has read the explanation and picked a period.
   * Asks Android for permission (only now), then runs the initial import.
   */
  async enable(historyMonths: SmsHistoryMonths): Promise<SmsPermission> {
    const permission = await this.requestPermission();
    const current = await this.store.getState();

    await this.store.saveState({ ...current, enabled: permission === 'granted', onboarded: true, historyMonths });
    await this.refreshState();

    if (permission === 'granted') await this.runScan(false);
    return permission;
  }

  async requestPermission(): Promise<SmsPermission> {
    const permission = await this.inbox.requestPermission().catch(() => 'denied' as const);
    this.permission.set(permission);
    return permission;
  }

  /** Re-reads the permission (e.g. after returning from Android Settings). */
  async refreshPermission(): Promise<void> {
    if (this.available) this.permission.set(await this.inbox.checkPermission().catch(() => 'denied' as const));
  }

  openAndroidSettings(): Promise<void> {
    return this.inbox.openAppSettings();
  }

  /** Turning it off stops future scans; imported transactions stay. */
  async setEnabled(enabled: boolean): Promise<void> {
    const current = await this.store.getState();
    await this.store.saveState({ ...current, enabled });
    await this.refreshState();
    if (enabled) await this.scanNow();
  }

  /** A longer period triggers a back-fill of the missing months on the next scan; shorter just limits new discovery. */
  async setHistoryMonths(historyMonths: SmsHistoryMonths): Promise<void> {
    const current = await this.store.getState();
    await this.store.saveState({ ...current, historyMonths });
    await this.refreshState();
    if (current.enabled && historyMonths > current.historyMonths) await this.scanNow();
  }

  async confirmReview(messageKey: string, candidate: SmsTransactionCandidate): Promise<boolean> {
    const tx = await this.engine.confirmReview(messageKey, candidate);
    if (tx) await this.transactions.loadAll();
    await this.refreshReview();
    return !!tx;
  }

  async rejectReview(messageKey: string): Promise<void> {
    await this.engine.rejectReview(messageKey);
    await this.refreshReview();
  }

  /** Forgets scan history and review items. Imported transactions are kept (and still de-duplicated). */
  async resetMetadata(): Promise<void> {
    if (this.engine.isRunning) return;
    await this.store.resetMetadata();
    this.lastOutcome.set(null);
    await this.refreshState();
  }

  private async runScan(auto: boolean): Promise<void> {
    if (this.scanning()) return;
    this.scanning.set(true);
    this.progress.set({ stage: 'connecting', checked: 0, candidates: 0 });

    try {
      const outcome = await this.engine.scan({ auto, onProgress: (p) => this.progress.set(p) });
      if (outcome.status === 'skipped' && auto) return;

      this.lastOutcome.set(outcome);
      if (outcome.status === 'permission_denied') await this.refreshPermission();
      if (outcome.status === 'success' && outcome.summary.imported > 0) await this.transactions.loadAll();
    } finally {
      this.scanning.set(false);
      this.progress.set(null);
      await this.refreshState();
    }
  }

  private async refreshState(): Promise<void> {
    this.state.set(await this.store.getState());
    await this.refreshReview();
  }

  private async refreshReview(): Promise<void> {
    this.reviewItems.set(await this.store.reviewRecords());
  }
}
