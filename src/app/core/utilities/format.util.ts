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

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** App-wide display format: DD-Mon-YYYY, with the 3-letter weekday, e.g. "21-Sep-2026 (Mon)". */
export function formatDateDisplay(date: string | Date, withDay = true): string {
  const d = typeof date === 'string' ? parseDate(date) : date;

  if (Number.isNaN(d.getTime())) {
    return '';
  }

  const day = d.getDate().toString().padStart(2, '0');
  const text = `${day}-${MONTH_ABBR[d.getMonth()]}-${d.getFullYear()}`;

  return withDay ? `${text} (${DAY_ABBR[d.getDay()]})` : text;
}

/** "HH:mm" (24h) -> "hh:mm AM/PM". Empty for missing/invalid input. */
export function formatTime12(time: string | undefined | null): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');

  if (!match) {
    return '';
  }

  const hours24 = Number(match[1]);
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

  return `${hours12.toString().padStart(2, '0')}:${match[2]} ${period}`;
}

/** Current local time as "HH:mm". */
export function currentTimeString(): string {
  const now = new Date();

  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
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
