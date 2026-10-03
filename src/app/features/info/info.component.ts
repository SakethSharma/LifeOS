import { Component, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ActivatedRoute } from "@angular/router";
import { AiService } from "../../core/services/ai.service";
import type { AiProviderId } from "../../core/ai/ai-contract";
import { AI_CONNECT_FRAGMENT, AI_KEY_GUIDE_FRAGMENT } from "../../core/ai/ai-provider-guides";
import { CollapsibleSectionComponent } from "../../shared/components/collapsible-section/collapsible-section.component";
import { AiConnectionPanelComponent } from "./components/ai-connection-panel/ai-connection-panel.component";
import { AiSetupCarouselComponent } from "./components/ai-setup-carousel/ai-setup-carousel.component";

/**
 * App information, privacy, and everything about setting up AI. Each section
 * opens and closes on its own; links elsewhere in the app deep-link here with
 * #ai-connect (connection panel) or #ai-key-guide (API key carousel).
 */
@Component({
  selector: "app-info",
  standalone: true,
  imports: [CollapsibleSectionComponent, AiConnectionPanelComponent, AiSetupCarouselComponent],
  templateUrl: "./info.component.html",
  styleUrl: "./info.component.scss",
})
export class InfoComponent {
  private ai = inject(AiService);
  private route = inject(ActivatedRoute);
  private injector = inject(Injector);

  private connectSection = viewChild<ElementRef<HTMLElement>>("connectSection");
  private guideSection = viewChild<ElementRef<HTMLElement>>("guideSection");
  private connectionPanel = viewChild(AiConnectionPanelComponent);

  privacyOpen = signal(false);
  aiOpen = signal(false);
  howOpen = signal(false);
  connectOpen = signal(true);
  guideOpen = signal(false);
  aiPrivacyOpen = signal(false);
  troubleshootingOpen = signal(false);

  guideProvider = signal<AiProviderId>(this.ai.connection()?.provider ?? "openai");

  aiPill = computed(() => {
    const status = this.ai.status();

    if (status.state === "testing") return { cls: "testing", text: "Connecting…" };
    if (!this.ai.isConnected()) return { cls: "off", text: "Not connected" };
    if (status.state === "error") return { cls: "issue", text: "Connection issue" };
    return { cls: "on", text: "Connected" };
  });

  constructor() {
    // Fragment changes also arrive while already on /info (e.g. a repeated link tap).
    this.route.fragment.pipe(takeUntilDestroyed()).subscribe((fragment) => {
      if (fragment === AI_CONNECT_FRAGMENT) {
        this.showConnect();
      } else if (fragment === AI_KEY_GUIDE_FRAGMENT) {
        this.showKeyGuide();
      }
    });
  }

  /** Opens "Connect AI to LifeOS", scrolls to it and focuses the key field. */
  showConnect(): void {
    this.aiOpen.set(true);
    this.connectOpen.set(true);

    this.afterRender(() => {
      scrollToSection(this.connectSection()?.nativeElement);
      // A failing saved key goes straight to "change key".
      this.connectionPanel()?.focusForSetup(this.ai.status().state === "error");
    });
  }

  /** "Don't have a key? See how" — opens the carousel even if it was collapsed, and brings it into view. */
  showKeyGuide(): void {
    this.aiOpen.set(true);
    this.guideOpen.set(true);

    this.afterRender(() => {
      const section = this.guideSection()?.nativeElement;
      scrollToSection(section);
      section?.querySelector<HTMLElement>(".carousel")?.focus({ preventScroll: true });
    });
  }

  onProviderChange(provider: AiProviderId): void {
    this.guideProvider.set(provider);
  }

  private afterRender(run: () => void): void {
    afterNextRender(run, { injector: this.injector });
  }
}

function scrollToSection(element: HTMLElement | undefined): void {
  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}
