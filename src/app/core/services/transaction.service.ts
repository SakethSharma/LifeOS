import { Injectable, signal, computed } from '@angular/core';
import { Transaction, NewTransaction } from '../models/transaction.model';
import { TransactionRepository } from '../repositories/transaction.repository';

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private repo = new TransactionRepository();
  private _transactions = signal<Transaction[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);

  readonly transactions = this._transactions.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly count = computed(() => this._transactions().length);

  async loadAll(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const data = await this.repo.getAll();
      this._transactions.set(data);
    } catch (e) {
      this._error.set('Failed to load transactions');
      console.error(e);
    } finally {
      this._loading.set(false);
    }
  }

  async add(data: NewTransaction): Promise<Transaction> {
    const tx = await this.repo.add(data);
    this._transactions.update((list) => [tx, ...list]);
    return tx;
  }

  async update(id: string, data: Partial<NewTransaction>): Promise<Transaction> {
    const tx = await this.repo.update(id, data);
    this._transactions.update((list) => list.map((t) => (t.id === id ? tx : t)));
    return tx;
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
    this._transactions.update((list) => list.filter((t) => t.id !== id));
  }

  async deleteAllDemo(): Promise<void> {
    await this.repo.deleteAllDemo();
    await this.loadAll();
  }

  async deleteAll(): Promise<void> {
    await this.repo.deleteAll();
    this._transactions.set([]);
  }

  async bulkAdd(transactions: Transaction[]): Promise<void> {
    await this.repo.bulkAdd(transactions);
    await this.loadAll();
  }

  async getCount(): Promise<number> {
    return this.repo.count();
  }
}
