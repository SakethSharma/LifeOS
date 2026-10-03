import { Component, computed, input, linkedSignal } from '@angular/core';
import type { AiProviderId } from '../../../../core/ai/ai-contract';
import { getProviderInfo } from '../../../../core/ai/ai-provider-guides';
import { clampStep, stepAfterSwipe } from './carousel-navigation';

/**
 * Step-by-step "get an API key" guide for the selected provider. Pictures are
 * schematic (drawn with CSS, no real screenshots or keys), and every step has
 * full text, so the guide works with images unavailable or a screen reader.
 */
@Component({
  selector: 'app-ai-setup-carousel',
  standalone: true,
  templateUrl: './ai-setup-carousel.component.html',
  styleUrl: './ai-setup-carousel.component.scss',
})
export class AiSetupCarouselComponent {
  provider = input<AiProviderId>('openai');

  info = computed(() => getProviderInfo(this.provider()));
  steps = computed(() => this.info().steps);

  /** Restarts at step 1 whenever the provider changes. */
  index = linkedSignal({ source: this.provider, computation: () => 0 });

  isFirst = computed(() => this.index() === 0);
  isLast = computed(() => this.index() === this.steps().length - 1);

  private touchStart: { x: number; y: number } | null = null;

  goTo(i: number): void {
    this.index.set(clampStep(i, this.steps().length));
  }

  next(): void {
    this.goTo(this.index() + 1);
  }

  previous(): void {
    this.goTo(this.index() - 1);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.previous();
    }
  }

  onTouchStart(event: TouchEvent): void {
    const t = event.touches[0];
    this.touchStart = t ? { x: t.clientX, y: t.clientY } : null;
  }

  onTouchEnd(event: TouchEvent): void {
    const t = event.changedTouches[0];

    if (this.touchStart && t) {
      this.index.set(
        stepAfterSwipe(this.index(), this.steps().length, t.clientX - this.touchStart.x, t.clientY - this.touchStart.y),
      );
    }

    this.touchStart = null;
  }
}
