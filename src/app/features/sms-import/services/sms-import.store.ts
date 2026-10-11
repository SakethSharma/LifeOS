import { db } from '../../../core/repositories/database';
import type { Transaction } from '../../../core/models/transaction.model';
import type { SmsImportStore } from '../engine/sms-import.engine';
import { defaultSmsImportState } from '../models/sms-import.model';
import type { SmsImportState, SmsMessageRecord } from '../models/sms-import.model';

/** SMS importer persistence on the existing LifeOS IndexedDB (Dexie) database. */
export class DexieSmsImportStore implements SmsImportStore {
  async getState(): Promise<SmsImportState> {
    return { ...defaultSmsImportState(), ...((await db.smsImportState.get('sms-import')) ?? {}) };
  }

  async saveState(state: SmsImportState): Promise<void> {
    await db.smsImportState.put(state);
  }

  async getMessageRecords(keys: string[]): Promise<Map<string, SmsMessageRecord>> {
    if (keys.length === 0) return new Map();
    const rows = await db.smsMessages.bulkGet(keys);
    return new Map(rows.filter((r): r is SmsMessageRecord => !!r).map((r) => [r.messageKey, r]));
  }

  async existingImportKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const rows = await db.transactions.where('importKey').anyOf(keys).toArray();
    return new Set(rows.map((t) => t.importKey!).filter(Boolean));
  }

  transactionsBetween(fromDate: string, toDate: string): Promise<Transaction[]> {
    return db.transactions.where('date').between(fromDate, toDate, true, true).toArray();
  }

  /** Transactions, message records and checkpoint in one IndexedDB transaction: all or nothing. */
  async commit(batch: { transactions: Transaction[]; records: SmsMessageRecord[]; state?: SmsImportState }): Promise<void> {
    await db.transaction('rw', db.transactions, db.smsMessages, db.smsImportState, async () => {
      if (batch.transactions.length) await db.transactions.bulkAdd(batch.transactions);
      if (batch.records.length) await db.smsMessages.bulkPut(batch.records);
      if (batch.state) await db.smsImportState.put(batch.state);
    });
  }

  pruneRecords(olderThan: number): Promise<number> {
    return db.smsMessages
      .where('smsDate')
      .below(olderThan)
      .and((r) => r.status !== 'review')
      .delete();
  }

  reviewRecords(): Promise<SmsMessageRecord[]> {
    return db.smsMessages.where('status').equals('review').sortBy('smsDate');
  }

  /** "Reset SMS import": forgets scan metadata only. Transactions are not touched. */
  async resetMetadata(): Promise<void> {
    await db.transaction('rw', db.smsMessages, db.smsImportState, async () => {
      await db.smsMessages.clear();
      await db.smsImportState.delete('sms-import');
    });
  }
}
