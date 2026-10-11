import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { SettingsService } from '../../../../core/services/settings.service';
import { SmsImportService } from '../../services/sms-import.service';
import { SMS_HISTORY_OPTIONS } from '../../models/sms-import.model';
import type { SmsHistoryMonths } from '../../models/sms-import.model';
import type { SmsScanStage } from '../../engine/sms-import.engine';
import { SmsReviewComponent } from '../sms-review/sms-review.component';

const STAGE_MESSAGES: Record<SmsScanStage, string[]> = {
  connecting: ['Connecting to your local messages…'],
  reading: ['Reading messages on this phone…', 'Finding genuine transactions…'],
  filtering: ['Filtering OTPs and promotional messages…', 'Finding genuine transactions…'],
  deduplicating: ['Checking for duplicates…'],
  saving: ['Updating your LifeOS dashboard…', 'Preparing your financial summary…'],
  done: ['Updating your LifeOS dashboard…'],
};

/** Settings → SMS Import: onboarding, permission, history period, scan status and review. */
@Component({
  selector: 'app-sms-import-card',
  standalone: true,
  imports: [SmsReviewComponent],
  templateUrl: './sms-import-card.component.html',
  styleUrl: './sms-import-card.component.scss',
})
export class SmsImportCardComponent {
  private sms = inject(SmsImportService);
  private settings = inject(SettingsService);

  readonly options = SMS_HISTORY_OPTIONS;
  readonly available = this.sms.available;

  state = this.sms.state;
  permission = this.sms.permission;
  scanning = this.sms.scanning;
  progress = this.sms.progress;
  outcome = this.sms.lastOutcome;
  reviewCount = this.sms.reviewCount;

  /** Period picked during onboarding (Current month by default). */
  chosenMonths = signal<SmsHistoryMonths>(1);
  confirmingReset = signal(false);
  showReview = signal(false);
  busy = signal(false);
  private tick = signal(0);

  statusLine = computed(() => {
    const p = this.progress();
    if (!p) return '';
    const messages = STAGE_MESSAGES[p.stage];
    return messages[this.tick() % messages.length];
  });

  lastScanText = computed(() => {
    const at = this.state().lastSuccessfulSmsScanAt;
    return at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
  });

  statusText = computed(() => {
    switch (this.state().lastScanStatus) {
      case 'success':
        return 'Last scan completed';
      case 'failed':
        return "Last scan didn't finish — nothing was changed. Try again.";
      case 'permission_denied':
        return 'SMS permission is off, so messages could not be read.';
      case 'unavailable':
        return 'SMS reading is not available on this device.';
      default:
        return 'Not scanned yet';
    }
  });

  resultText = computed(() => {
    const o = this.outcome();
    if (!o) return '';
    switch (o.status) {
      case 'success': {
        const s = o.summary;
        if (s.imported === 0 && s.awaitingReview === 0) return 'All caught up — no new transactions found.';
        const parts = [`${s.imported} imported`];
        if (s.awaitingReview) parts.push(`${s.awaitingReview} to review`);
        return `${parts.join(', ')} · ${s.checked} messages checked, ${s.ignored} ignored`;
      }
      case 'failed':
        return "The scan didn't finish. Your transactions are unchanged — tap Scan messages now to retry.";
      case 'permission_denied':
        return 'SMS permission is needed to scan.';
      case 'unavailable':
        return 'SMS reading is not available here.';
      default:
        return '';
    }
  });

  constructor() {
    // Rotate the friendly status line while a scan runs.
    const timer = setInterval(() => {
      if (this.progress()) this.tick.update((t) => t + 1);
    }, 1800);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));

    void this.sms.refreshPermission();
  }

  currencySymbol(): string {
    return this.settings.currencySymbol();
  }

  async enable(): Promise<void> {
    await this.run(() => this.sms.enable(this.chosenMonths()));
  }

  async requestPermission(): Promise<void> {
    await this.run(async () => {
      if ((await this.sms.requestPermission()) === 'granted' && !this.state().enabled) await this.sms.setEnabled(true);
    });
  }

  async openAndroidSettings(): Promise<void> {
    await this.sms.openAndroidSettings();
  }

  async toggleEnabled(): Promise<void> {
    await this.run(() => this.sms.setEnabled(!this.state().enabled));
  }

  async onHistoryChange(event: Event): Promise<void> {
    const months = Number((event.target as HTMLSelectElement).value) as SmsHistoryMonths;
    await this.run(() => this.sms.setHistoryMonths(months));
  }

  async scanNow(): Promise<void> {
    await this.sms.scanNow();
  }

  async confirmReset(): Promise<void> {
    await this.run(() => this.sms.resetMetadata());
    this.confirmingReset.set(false);
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
