import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
} from "@angular/core";
import { BackButtonService } from "../../../core/services/back-button.service";

@Component({
  selector: "app-confirm-dialog",
  templateUrl: "./confirm-dialog.component.html",
  styleUrl: "./confirm-dialog.component.scss",
})
export class ConfirmDialogComponent implements OnChanges, OnDestroy {
  private readonly backButton = inject(BackButtonService);
  private unregisterBack: (() => void) | null = null;

  @Input() open = false;
  @Input() title = "Confirm";
  @Input() message = "Are you sure?";
  @Input() confirmText = "Confirm";
  @Input() cancelText = "Cancel";
  @Input() danger = false;

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes["open"]) {
      return;
    }

    this.unregisterBack?.();
    this.unregisterBack = null;

    // While open, Android Back cancels the dialog instead of leaving the page.
    if (this.open) {
      this.unregisterBack = this.backButton.register(() => this.onCancel());
    }
  }

  ngOnDestroy(): void {
    this.unregisterBack?.();
  }

  onConfirm(): void {
    this.confirmed.emit();
  }

  onCancel(): void {
    this.cancelled.emit();
  }
}
