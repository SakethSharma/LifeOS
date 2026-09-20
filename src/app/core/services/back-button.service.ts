import { Injectable, inject } from "@angular/core";
import { Location } from "@angular/common";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";

/**
 * Android hardware/gesture Back handling.
 *
 * Overlays (side drawer, dialogs) register a close callback while they are
 * open. On Back, the most recently opened overlay closes first; otherwise the
 * app navigates to the previous route; it exits only when there is no
 * previous navigation state. Outside the native app this does nothing, so
 * browser Back keeps its normal behaviour.
 */
@Injectable({ providedIn: "root" })
export class BackButtonService {
  private readonly location = inject(Location);
  private readonly overlays: Array<() => void> = [];
  private started = false;

  /** Registers an open overlay's close callback. Returns an unregister function. */
  register(close: () => void): () => void {
    this.overlays.push(close);

    return () => {
      const index = this.overlays.lastIndexOf(close);

      if (index >= 0) {
        this.overlays.splice(index, 1);
      }
    };
  }

  async init(): Promise<void> {
    if (this.started || !Capacitor.isNativePlatform()) {
      return;
    }

    this.started = true;

    await CapacitorApp.addListener("backButton", ({ canGoBack }) => {
      this.handleBack(canGoBack);
    });
  }

  private handleBack(canGoBack: boolean): void {
    const closeTopOverlay = this.overlays[this.overlays.length - 1];

    if (closeTopOverlay) {
      closeTopOverlay();
      return;
    }

    if (canGoBack) {
      this.location.back();
      return;
    }

    void CapacitorApp.exitApp();
  }
}
