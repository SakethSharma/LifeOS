import { DateRange } from "../models/analytics.model";
import { DateRangePreset } from "../models/settings.model";
import { toDateString } from "./format.util";

export function getDateRange(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
): DateRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case "this_month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0,
        23,
        59,
        59,
      );
      return { start, end, label: "This Month" };
    }
    case "previous_month": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(
        today.getFullYear(),
        today.getMonth(),
        0,
        23,
        59,
        59,
      );
      return { start, end, label: "Previous Month" };
    }
    case "last_3_months": {
      const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      const end = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0,
        23,
        59,
        59,
      );
      return { start, end, label: "Last 3 Months" };
    }
    case "last_6_months": {
      const start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
      const end = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0,
        23,
        59,
        59,
      );
      return { start, end, label: "Last 6 Months" };
    }
    case "this_year": {
      const start = new Date(today.getFullYear(), 0, 1);
      const end = new Date(today.getFullYear(), 11, 31, 23, 59, 59);
      return { start, end, label: "This Year" };
    }
    case "custom": {
      const start = customStart ? new Date(customStart) : today;
      const end = customEnd ? new Date(customEnd) : today;
      end.setHours(23, 59, 59);
      return { start, end, label: "Custom Range" };
    }
    default: {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0,
        23,
        59,
        59,
      );
      return { start, end, label: "This Month" };
    }
  }
}

export function getPreviousDateRange(range: DateRange): DateRange {
  const duration = range.end.getTime() - range.start.getTime();
  const end = new Date(range.start.getTime() - 1);
  const start = new Date(end.getTime() - duration);
  return { start, end, label: `Previous ${range.label}` };
}

export function getMonthLabel(date: Date): string {
  return date.toLocaleString("en-US", { month: "short", year: "numeric" });
}

export function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
}

export function getDayLabel(date: Date): string {
  return date.toLocaleString("en-US", { day: "numeric", month: "short" });
}

export function isInRange(dateStr: string, start: Date, end: Date): boolean {
  const d = new Date(dateStr + "T00:00:00");
  return d >= start && d <= end;
}

export function toRangeString(range: DateRange): string {
  return `${toDateString(range.start)} - ${toDateString(range.end)}`;
}
