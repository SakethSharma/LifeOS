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
  viewChild,
} from "@angular/core";
import { BackButtonService } from "../../../core/services/back-button.service";

export interface SelectOption {
  value: string;
  label: string;
}

let nextId = 0;

/**
 * Dropdown whose option list is exactly as wide as its trigger. Long labels
 * wrap instead of being cut off. The list stays inside the viewport and opens
 * upward when there is no room below.
 */
@Component({
  selector: "app-select",
  templateUrl: "./select.component.html",
  styleUrl: "./select.component.scss",
})
export class SelectComponent implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly backButton = inject(BackButtonService);

  readonly uid = `app-select-${nextId++}`;

  options = input<SelectOption[]>([]);
  value = input<string>("");
  placeholder = input<string>("");
  ariaLabel = input<string>("");
  disabled = input<boolean>(false);

  valueChange = output<string>();

  private trigger = viewChild<ElementRef<HTMLButtonElement>>("trigger");
  private panel = viewChild<ElementRef<HTMLElement>>("panel");

  open = signal(false);
  activeIndex = signal(-1);
  pos = signal<{
    left: number;
    width: number;
    top: number | null;
    bottom: number | null;
    maxHeight: number;
  }>({ left: 0, width: 0, top: 0, bottom: null, maxHeight: 280 });

  selectedLabel = computed(
    () => this.options().find((o) => o.value === this.value())?.label ?? "",
  );

  private ignoreClickUntil = 0;

  private readonly onScroll = (event: Event): void => {
    // Scrolling the list itself must not close it; scrolling the page does.
    if (this.panel()?.nativeElement.contains(event.target as Node)) {
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
    // While open, Android Back closes the list before anything else.
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

  onTriggerClick(): void {
    if (Date.now() < this.ignoreClickUntil) {
      return;
    }

    this.open() ? this.close() : this.openPanel();
  }

  onKeydown(event: KeyboardEvent): void {
    const options = this.options();

    if (!this.open()) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        this.openPanel();
      }

      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.moveActive(1);
        break;

      case "ArrowUp":
        event.preventDefault();
        this.moveActive(-1);
        break;

      case "Home":
        event.preventDefault();
        this.setActive(0);
        break;

      case "End":
        event.preventDefault();
        this.setActive(options.length - 1);
        break;

      case "Enter":
      case " ": {
        event.preventDefault();
        // The browser also fires a click for Enter/Space; ignore it.
        this.ignoreClickUntil = Date.now() + 400;
        const option = options[this.activeIndex()];

        if (option) {
          this.choose(option);
        } else {
          this.close();
        }

        break;
      }

      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        this.close();
        break;

      case "Tab":
        this.close();
        break;
    }
  }

  choose(option: SelectOption): void {
    this.valueChange.emit(option.value);
    this.close();
    this.trigger()?.nativeElement.focus();
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
    const trigger = this.trigger()?.nativeElement;

    if (this.disabled() || !trigger || this.options().length === 0) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const wanted = Math.min(280, this.options().length * 38 + 8);
    const openUp = spaceBelow < wanted && spaceAbove > spaceBelow;
    const available = openUp ? spaceAbove : spaceBelow;

    this.pos.set({
      left: rect.left,
      width: rect.width,
      top: openUp ? null : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : null,
      maxHeight: Math.max(120, Math.min(280, available - 4)),
    });

    const selected = this.options().findIndex((o) => o.value === this.value());

    this.activeIndex.set(selected >= 0 ? selected : 0);
    this.open.set(true);

    document.addEventListener("scroll", this.onScroll, true);
    document.addEventListener("click", this.onOutsideClick, true);

    // Once rendered, the panel's width is known: keep it inside the viewport.
    afterNextRender(
      () => {
        this.fitHorizontally();
        this.revealActive();
      },
      { injector: this.injector },
    );
  }

  private fitHorizontally(): void {
    const panel = this.panel()?.nativeElement;

    if (!panel) {
      return;
    }

    const margin = 8;
    const maxLeft = window.innerWidth - panel.offsetWidth - margin;
    const left = Math.max(margin, Math.min(this.pos().left, maxLeft));

    if (left !== this.pos().left) {
      this.pos.update((p) => ({ ...p, left }));
    }
  }

  private moveActive(step: number): void {
    const count = this.options().length;

    if (count === 0) {
      return;
    }

    this.setActive((this.activeIndex() + step + count) % count);
  }

  private setActive(index: number): void {
    this.activeIndex.set(index);
    this.revealActive();
  }

  // Keeps the highlighted option visible by scrolling the list only.
  private revealActive(): void {
    const panel = this.panel()?.nativeElement;
    const option = panel?.children[this.activeIndex()] as HTMLElement | undefined;

    if (!panel || !option) {
      return;
    }

    if (option.offsetTop < panel.scrollTop) {
      panel.scrollTop = option.offsetTop;
    } else if (
      option.offsetTop + option.offsetHeight >
      panel.scrollTop + panel.clientHeight
    ) {
      panel.scrollTop = option.offsetTop + option.offsetHeight - panel.clientHeight;
    }
  }
}
