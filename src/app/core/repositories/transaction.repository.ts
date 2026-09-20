import { db } from "./database";
import { Transaction, NewTransaction } from "../models/transaction.model";

export class TransactionRepository {
  private generateId(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 11);
  }

  async getAll(): Promise<Transaction[]> {
    return db.transactions.orderBy("date").reverse().toArray();
  }

  async getById(id: string): Promise<Transaction | undefined> {
    return db.transactions.get(id);
  }

  async add(data: NewTransaction): Promise<Transaction> {
    const now = new Date().toISOString();
    const transaction: Transaction = {
      id: this.generateId(),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await db.transactions.add(transaction);
    return transaction;
  }

  async update(
    id: string,
    data: Partial<NewTransaction>,
  ): Promise<Transaction> {
    const existing = await db.transactions.get(id);
    if (!existing) {
      throw new Error(`Transaction ${id} not found`);
    }
    const updated: Transaction = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };
    await db.transactions.put(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await db.transactions.delete(id);
  }

  async deleteAllDemo(): Promise<number> {
    const demoTransactions = await db.transactions
      .filter((transaction) => transaction.isDemo === true)
      .toArray();

    await db.transactions.bulkDelete(demoTransactions.map((transaction) => transaction.id));
    return demoTransactions.length;
  }

  async deleteAll(): Promise<number> {
    const count = await db.transactions.count();
    await db.transactions.clear();
    return count;
  }

  async count(): Promise<number> {
    return db.transactions.count();
  }

  async bulkAdd(transactions: Transaction[]): Promise<void> {
    await db.transactions.bulkAdd(transactions);
  }

  async getByDateRange(start: string, end: string): Promise<Transaction[]> {
    return db.transactions
      .where("date")
      .between(start, end, true, true)
      .reverse()
      .toArray();
  }
}
