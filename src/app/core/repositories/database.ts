import Dexie, { Table } from 'dexie';
import { Transaction } from '../models/transaction.model';
import { AppSettings } from '../models/settings.model';
import type { SmsImportState, SmsMessageRecord } from '../../features/sms-import/models/sms-import.model';

export class LifeOSDatabase extends Dexie {
  transactions!: Table<Transaction, string>;
  settings!: Table<AppSettings, string>;
  /** SMS importer checkpoint (one row). */
  smsImportState!: Table<SmsImportState, string>;
  /** Minimal per-message metadata (hash, status, date) — never message text. */
  smsMessages!: Table<SmsMessageRecord, string>;

  constructor() {
    super('LifeOSDB');
    this.version(1).stores({
      transactions: 'id, type, category, date, isDemo, createdAt',
      settings: 'id',
    });
    // Additive: existing transactions and settings are kept as they are.
    this.version(2).stores({
      transactions: 'id, type, category, date, isDemo, createdAt, importKey',
      settings: 'id',
      smsImportState: 'id',
      smsMessages: 'messageKey, status, smsDate',
    });
  }
}

export const db = new LifeOSDatabase();
