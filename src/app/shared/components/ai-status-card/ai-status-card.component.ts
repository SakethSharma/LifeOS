import { Component, computed, input, output } from '@angular/core';
import type { AiErrorAction, AiErrorActionButton, AiErrorView } from '../../../core/ai/ai-errors';

/** Friendly AI problem card: icon, short title, explanation, and clear next actions. */
@Component({
  selector: 'app-ai-status-card',
  standalone: true,
  templateUrl: './ai-status-card.component.html',
  styleUrl: './ai-status-card.component.scss',
})
export class AiStatusCardComponent {
  view = input.required<AiErrorView>();
  tone = input<'info' | 'warning'>('warning');
  /** "Switch Provider" is only offered when another configured provider is ready to use. */
  canSwitchProvider = input(false);

  action = output<AiErrorAction>();

  extraActions = computed<AiErrorActionButton[]>(() =>
    (this.view().extraActions ?? []).filter((a) => a.action !== 'switch-provider' || this.canSwitchProvider()),
  );
}
