import Dexie, { Table } from 'dexie';
import { Transaction } from '../models/transaction.model';
import { AppSettings } from '../models/settings.model';

export class LifeOSDatabase extends Dexie {
  transactions!: Table<Transaction, string>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super('LifeOSDB');
    this.version(1).stores({
      transactions: 'id, type, category, date, isDemo, createdAt',
      settings: 'id',
    });
  }
}

export const db = new LifeOSDatabase();
