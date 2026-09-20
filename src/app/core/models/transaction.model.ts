export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  date: string;
  /** Local time of day as "HH:mm" (24h). Optional: older records have none. */
  time?: string;
  description: string;
  paymentMethod?: string;
  notes?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewTransaction {
  type: TransactionType;
  amount: number;
  category: string;
  date: string;
  time?: string;
  description: string;
  paymentMethod?: string;
  notes?: string;
}

export const EXPENSE_CATEGORIES = [
  'Food',
  'Transportation',
  'Housing',
  'Shopping',
  'Bills',
  'Health',
  'Education',
  'Entertainment',
  'Other',
] as const;

export const INCOME_CATEGORIES = [
  'Salary',
  'Freelance',
  'Business',
  'Gift',
  'Other',
] as const;

export const PAYMENT_METHODS = [
  'Cash',
  'Credit Card',
  'Debit Card',
  'Bank Transfer',
  'UPI',
  'Digital Wallet',
  'Other',
] as const;
