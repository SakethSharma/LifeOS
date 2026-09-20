import { Pipe, PipeTransform } from "@angular/core";
import { formatCurrency } from "../../core/utilities/format.util";

@Pipe({ name: "currencyFormat" })
export class CurrencyFormatPipe implements PipeTransform {
  transform(value: number, symbol: string = "₹"): string {
    return formatCurrency(value, symbol);
  }
}
