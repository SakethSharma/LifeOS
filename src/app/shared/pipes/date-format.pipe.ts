import { Pipe, PipeTransform } from "@angular/core";
import { formatDateDisplay } from "../../core/utilities/format.util";

// Dates are always shown as DD-Mon-YYYY (Day), e.g. "21-Sep-2026 (Mon)".
@Pipe({ name: "dateFormat" })
export class DateFormatPipe implements PipeTransform {
  transform(value: string | Date): string {
    if (!value) return "";
    return formatDateDisplay(value);
  }
}
