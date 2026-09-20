import { Pipe, PipeTransform } from "@angular/core";
import { formatDate } from "../../core/utilities/format.util";
import { DateFormat } from "../../core/models/settings.model";

@Pipe({ name: "dateFormat" })
export class DateFormatPipe implements PipeTransform {
  transform(value: string | Date, format: DateFormat = "MMM d, yyyy"): string {
    if (!value) return "";
    return formatDate(value, format);
  }
}
