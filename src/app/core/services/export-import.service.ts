import { Injectable } from '@angular/core';
import { Transaction } from '../models/transaction.model';
import { TransactionService } from './transaction.service';
import { SettingsService } from './settings.service';

export interface ExportData {
  version: string;
  exportedAt: string;
  transactions: Transaction[];
  settings: Record<string, unknown> | null;
}

@Injectable({ providedIn: 'root' })
export class ExportImportService {
  constructor(
    private transactionService: TransactionService,
    private settingsService: SettingsService
  ) {}

  async exportData(): Promise<string> {
    const transactions = this.transactionService.transactions();
    const settings = this.settingsService.current;

    const data: ExportData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      transactions,
      settings: settings ? { ...settings } : null,
    };

    return JSON.stringify(data, null, 2);
  }

  downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  exportCsv(transactions: Transaction[]): string {
    const headers = ['ID', 'Type', 'Amount', 'Category', 'Date', 'Description', 'Payment Method', 'Notes', 'Created At'];
    const rows = transactions.map((t) => [
      t.id,
      t.type,
      t.amount.toString(),
      t.category,
      t.date,
      this.csvEscape(t.description),
      this.csvEscape(t.paymentMethod ?? ''),
      this.csvEscape(t.notes ?? ''),
      t.createdAt,
    ]);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  validateImport(json: string): { valid: boolean; data?: ExportData; error?: string } {
    try {
      const parsed = JSON.parse(json);
      if (!parsed.version || !parsed.transactions || !Array.isArray(parsed.transactions)) {
        return { valid: false, error: 'Invalid file format: missing version or transactions array' };
      }
      for (const t of parsed.transactions) {
        if (!t.id || !t.type || typeof t.amount !== 'number' || !t.category || !t.date) {
          return { valid: false, error: 'Invalid transaction data: missing required fields' };
        }
        if (t.type !== 'income' && t.type !== 'expense') {
          return { valid: false, error: `Invalid transaction type: ${t.type}` };
        }
      }
      return { valid: true, data: parsed as ExportData };
    } catch (e) {
      return { valid: false, error: 'Invalid JSON file' };
    }
  }

  async importData(json: string): Promise<{ success: boolean; count: number; error?: string }> {
    const result = this.validateImport(json);
    if (!result.valid || !result.data) {
      return { success: false, count: 0, error: result.error };
    }

    try {
      const transactions = result.data.transactions.map((t) => ({
        ...t,
        createdAt: t.createdAt ?? new Date().toISOString(),
        updatedAt: t.updatedAt ?? new Date().toISOString(),
      }));
      await this.transactionService.bulkAdd(transactions);
      return { success: true, count: transactions.length };
    } catch (e) {
      return { success: false, count: 0, error: 'Failed to import data into database' };
    }
  }
}
