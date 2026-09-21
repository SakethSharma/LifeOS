import { Injectable, signal } from '@angular/core';
import { Transaction } from '../models/transaction.model';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from '../models/transaction.model';
import { toDateString } from '../utilities/format.util';

@Injectable({ providedIn: 'root' })
export class DemoDataService {
  private generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'demo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
  }

  generate(count: number = 120): Transaction[] {
    const transactions: Transaction[] = [];
    const now = new Date();
    const descriptions: Record<string, string[]> = {
      Food: ['Grocery shopping', 'Restaurant dinner', 'Lunch', 'Coffee', 'Snacks', 'Food delivery'],
      Transportation: ['Uber ride', 'Fuel', 'Bus pass', 'Train ticket', 'Parking fee'],
      Housing: ['Monthly rent', 'Electricity bill', 'Water bill', 'Internet bill', 'Maintenance'],
      Shopping: ['Clothes', 'Electronics', 'Home decor', 'Books', 'Online order'],
      Bills: ['Phone bill', 'Insurance premium', 'Subscription', 'Gas bill'],
      Health: ['Pharmacy', 'Doctor visit', 'Gym membership', 'Health checkup'],
      Education: ['Online course', 'Books purchase', 'Workshop fee', 'Certification'],
      Entertainment: ['Movie tickets', 'Concert', 'Streaming subscription', 'Game purchase'],
      Other: ['Miscellaneous', 'Gift', 'Donation'],
      Salary: ['Monthly salary'],
      Freelance: ['Freelance project payment', 'Consulting fee'],
      Business: ['Business income', 'Product sale'],
      Gift: ['Birthday gift received', 'Festival gift'],
    };

    for (let i = 0; i < count; i++) {
      const monthsBack = Math.floor(Math.random() * 6);
      const day = Math.floor(Math.random() * 28) + 1;
      const date = new Date(now.getFullYear(), now.getMonth() - monthsBack, day);
      // Local date: toISOString() would shift to UTC and can move a transaction into the previous day/month.
      const dateStr = toDateString(date);

      const isIncome = Math.random() < 0.2;
      const type = isIncome ? 'income' : 'expense';
      const categories = isIncome ? [...INCOME_CATEGORIES] : [...EXPENSE_CATEGORIES];
      const category = categories[Math.floor(Math.random() * categories.length)];
      const descList = descriptions[category] ?? ['Transaction'];
      const description = descList[Math.floor(Math.random() * descList.length)];

      const amount = isIncome
        ? Math.floor(Math.random() * 40000) + 10000
        : Math.floor(Math.random() * 3000) + 100;

      const paymentMethod = PAYMENT_METHODS[Math.floor(Math.random() * PAYMENT_METHODS.length)];

      transactions.push({
        id: this.generateId(),
        type,
        amount,
        category,
        date: dateStr,
        description,
        paymentMethod,
        notes: '',
        isDemo: true,
        createdAt: date.toISOString(),
        updatedAt: date.toISOString(),
      });
    }

    return transactions.sort((a, b) => b.date.localeCompare(a.date));
  }
}
