import { Injectable, signal } from '@angular/core';

export interface StorageInfo {
  available: boolean;
  transactionCount: number;
  usageBytes: number | null;
  quotaBytes: number | null;
  supported: boolean;
}

@Injectable({ providedIn: 'root' })
export class StorageService {
  readonly info = signal<StorageInfo>({
    available: false,
    transactionCount: 0,
    usageBytes: null,
    quotaBytes: null,
    supported: false,
  });

  async estimate(transactionCount: number): Promise<StorageInfo> {
    let usageBytes: number | null = null;
    let quotaBytes: number | null = null;
    let supported = false;

    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        usageBytes = estimate.usage ?? null;
        quotaBytes = estimate.quota ?? null;
        supported = true;
      } catch {
        supported = false;
      }
    }

    const available = typeof indexedDB !== 'undefined';

    return {
      available,
      transactionCount,
      usageBytes,
      quotaBytes,
      supported,
    };
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}
