import { Component, model } from "@angular/core";

/**
 * Generic show/hide wrapper: a clickable header (projected via the
 * `collapsible-header` slot) toggles the default-slot body. Callers own the
 * expanded state as a signal and bind it two-way with `[(expanded)]`.
 */
@Component({
  selector: "app-collapsible-section",
  standalone: true,
  templateUrl: "./collapsible-section.component.html",
  styleUrl: "./collapsible-section.component.scss",
})
export class CollapsibleSectionComponent {
  expanded = model<boolean>(true);

  toggle(): void {
    this.expanded.update((v) => !v);
  }
}
