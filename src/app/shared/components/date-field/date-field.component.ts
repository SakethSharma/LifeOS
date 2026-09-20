import {
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChild,
} from "@angular/core";
import { formatDateDisplay } from "../../../core/utilities/format.util";

/**
 * Date input that always shows "DD-Mon-YYYY (Day)". A transparent native
 * <input type="date"> sits on top, so tapping anywhere opens the calendar and
 * the value is still a plain "YYYY-MM-DD" string.
 */
@Component({
  selector: "app-date-field",
  templateUrl: "./date-field.component.html",
  styleUrl: "./date-field.component.scss",
})
export class DateFieldComponent {
  value = input<string>("");
  ariaLabel = input<string>("Date");

  valueChange = output<string>();

  private native = viewChild<ElementRef<HTMLInputElement>>("native");

  display = computed(() =>
    this.value() ? formatDateDisplay(this.value()) : "",
  );

  openPicker(): void {
    try {
      this.native()?.nativeElement.showPicker();
    } catch {
      // Already open, or not supported: the native input handles the tap itself.
    }
  }

  onChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;

    if (value) {
      this.valueChange.emit(value);
    }
  }
}
