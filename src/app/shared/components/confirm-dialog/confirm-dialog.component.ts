import { Component, Input, Output, EventEmitter } from "@angular/core";

@Component({
  selector: "app-confirm-dialog",
  templateUrl: "./confirm-dialog.component.html",
  styleUrl: "./confirm-dialog.component.scss",
})
export class ConfirmDialogComponent {
  @Input() open = false;
  @Input() title = "Confirm";
  @Input() message = "Are you sure?";
  @Input() confirmText = "Confirm";
  @Input() cancelText = "Cancel";
  @Input() danger = false;

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  onConfirm(): void {
    this.confirmed.emit();
  }

  onCancel(): void {
    this.cancelled.emit();
  }
}
