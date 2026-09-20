import { DateFormat } from '../models/settings.model';

export function formatCurrency(amount: number, symbol: string): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const prefix = amount < 0 ? '-' : '';
  return `${prefix}${symbol}${formatted}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDate(date: string | Date, format: DateFormat): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  const monthShort = d.toLocaleString('en-US', { month: 'short' });
  const dayNum = d.getDate();

  switch (format) {
    case 'MMM d, yyyy':
      return `${monthShort} ${dayNum}, ${year}`;
    case 'd MMM yyyy':
      return `${dayNum} ${monthShort} ${year}`;
    case 'yyyy-MM-dd':
      return `${year}-${month}-${day}`;
    case 'dd/MM/yyyy':
      return `${day}/${month}/${year}`;
    case 'MM/dd/yyyy':
      return `${month}/${day}/${year}`;
    default:
      return `${monthShort} ${dayNum}, ${year}`;
  }
}

export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}
