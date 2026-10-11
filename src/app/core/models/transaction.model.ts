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
  /** Where the record came from. Absent = entered by the user (or older records). */
  source?: TransactionSource;
  /**
   * Stable duplicate-check key for imported records (bank reference or a
   * fingerprint of normalized fields). Never contains raw message text.
   */
  importKey?: string;
  createdAt: string;
  updatedAt: string;
}

export type TransactionSource = 'sms';

export interface NewTransaction {
  type: TransactionType;
  amount: number;
  category: string;
  date: string;
  time?: string;
  description: string;
  paymentMethod?: string;
  notes?: string;
  source?: TransactionSource;
  importKey?: string;
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
  /** Refunds and reversals of earlier spending (e.g. imported from bank SMS). */
  'Refund',
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
