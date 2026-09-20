import {
  Component,
  ElementRef,
  HostListener,
  Injector,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { BackButtonService } from "../../../core/services/back-button.service";
import { formatTime12 } from "../../../core/utilities/format.util";

type TimePart = "hour" | "minute" | "period";

const PANEL_WIDTH = 224;
const PANEL_HEIGHT = 252;

const pad = (n: number): string => n.toString().padStart(2, "0");

/**
 * 12-hour time input. Shows "hh:mm AM/PM" and picks hour / minute / AM-PM from
 * a small popover, so it is 12-hour on every device. The value is "HH:mm" (24h).
 */
@Component({
  selector: "app-time-field",
  templateUrl: "./time-field.component.html",
  styleUrl: "./time-field.component.scss",
})
export class TimeFieldComponent implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly backButton = inject(BackButtonService);

  value = input<string>("");
  ariaLabel = input<string>("Time");

  valueChange = output<string>();

  open = signal(false);
  pos = signal<{ left: number; top: number | null; bottom: number | null }>({
    left: 0,
    top: 0,
    bottom: null,
  });

  readonly hours = Array.from({ length: 12 }, (_, i) => pad(i + 1));
  readonly minutes = Array.from({ length: 60 }, (_, i) => pad(i));
  readonly periods = ["AM", "PM"];

  display = computed(() => formatTime12(this.value()));

  parts = computed(() => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(this.value());
    const hours24 = match ? Number(match[1]) : 0;

    return {
      hour: pad(hours24 % 12 === 0 ? 12 : hours24 % 12),
      minute: match ? match[2] : "00",
      period: hours24 >= 12 ? "PM" : "AM",
    };
  });

  private readonly onScroll = (event: Event): void => {
    // Scrolling a column inside the popover must not close it.
    if (this.host.nativeElement.querySelector(".time-panel")?.contains(event.target as Node)) {
      return;
    }

    this.close();
  };

  // Capture phase, so dialogs that stop click propagation cannot hide outside clicks.
  private readonly onOutsideClick = (event: Event): void => {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  };

  constructor() {
    // While open, Android Back closes the popover before anything else.
    effect((onCleanup) => {
      if (this.open()) {
        onCleanup(this.backButton.register(() => this.close()));
      }
    });
  }

  ngOnDestroy(): void {
    this.removeGlobalListeners();
  }

  @HostListener("window:resize")
  onResize(): void {
    this.close();
  }

  @HostListener("keydown.escape", ["$event"])
  onEscape(event: Event): void {
    if (this.open()) {
      event.stopPropagation();
      this.close();
    }
  }

  toggle(): void {
    this.open() ? this.close() : this.openPanel();
  }

  pick(part: TimePart, value: string): void {
    const next = { ...this.parts(), [part]: value };
    const hours24 = (Number(next.hour) % 12) + (next.period === "PM" ? 12 : 0);

    this.valueChange.emit(`${pad(hours24)}:${next.minute}`);
  }

  close(): void {
    if (!this.open()) {
      return;
    }

    this.open.set(false);
    this.removeGlobalListeners();
  }

  private removeGlobalListeners(): void {
    document.removeEventListener("scroll", this.onScroll, true);
    document.removeEventListener("click", this.onOutsideClick, true);
  }

  private openPanel(): void {
    const trigger = this.host.nativeElement.querySelector<HTMLElement>(".time-trigger");

    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const openUp =
      window.innerHeight - rect.bottom < PANEL_HEIGHT + margin &&
      rect.top > window.innerHeight - rect.bottom;

    this.pos.set({
      left: Math.max(margin, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - margin)),
      top: openUp ? null : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : null,
    });

    this.open.set(true);
    document.addEventListener("scroll", this.onScroll, true);
    document.addEventListener("click", this.onOutsideClick, true);

    afterNextRender(() => this.centerSelected(), { injector: this.injector });
  }

  // Scrolls each column so the current hour / minute / period is in view.
  private centerSelected(): void {
    const columns = this.host.nativeElement.querySelectorAll<HTMLElement>(".time-col");

    columns.forEach((column) => {
      const selected = column.querySelector<HTMLElement>(".selected");

      if (selected) {
        column.scrollTop =
          selected.offsetTop - (column.clientHeight - selected.offsetHeight) / 2;
      }
    });
  }
}
