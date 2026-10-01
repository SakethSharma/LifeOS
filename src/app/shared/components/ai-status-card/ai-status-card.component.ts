import { Component, input, output } from '@angular/core';
import type { AiErrorAction, AiErrorView } from '../../../core/ai/ai-errors';

/** Friendly AI problem card: icon, short title, explanation, and one next action. */
@Component({
  selector: 'app-ai-status-card',
  standalone: true,
  templateUrl: './ai-status-card.component.html',
  styleUrl: './ai-status-card.component.scss',
})
export class AiStatusCardComponent {
  view = input.required<AiErrorView>();
  tone = input<'info' | 'warning'>('warning');

  action = output<AiErrorAction>();
}
