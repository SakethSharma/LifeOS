export type ThemeMode = 'light' | 'dark' | 'system';

export type DateFormat = 'MMM d, yyyy' | 'd MMM yyyy' | 'yyyy-MM-dd' | 'dd/MM/yyyy' | 'MM/dd/yyyy';

export type DateRangePreset =
  | 'this_month'
  | 'previous_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_year'
  | 'custom';

export interface AppSettings {
  id: string;
  theme: ThemeMode;
  currency: string;
  currencySymbol: string;
  dateFormat: DateFormat;
  defaultDateRange: DateRangePreset;
  hasSeenWelcome?: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app-settings',
  theme: 'system',
  currency: 'INR',
  currencySymbol: '₹',
  dateFormat: 'MMM d, yyyy',
  defaultDateRange: 'this_month',
  hasSeenWelcome: false,
};

export const SUPPORTED_CURRENCIES: { code: string; symbol: string; name: string }[] = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
];

export const DATE_FORMATS: { value: DateFormat; label: string; example: string }[] = [
  { value: 'MMM d, yyyy', label: 'Month Day, Year', example: 'Sep 5, 2026' },
  { value: 'd MMM yyyy', label: 'Day Month Year', example: '5 Sep 2026' },
  { value: 'yyyy-MM-dd', label: 'ISO Format', example: '2026-09-05' },
  { value: 'dd/MM/yyyy', label: 'Day/Month/Year', example: '05/09/2026' },
  { value: 'MM/dd/yyyy', label: 'Month/Day/Year', example: '09/05/2026' },
];

export const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'previous_month', label: 'Previous Month' },
  { value: 'last_3_months', label: 'Last 3 Months' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'this_year', label: 'This Year' },
  { value: 'custom', label: 'Custom Range' },
];
