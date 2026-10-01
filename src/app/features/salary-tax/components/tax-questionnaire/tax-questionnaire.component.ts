import { Component, computed, input, model, output } from '@angular/core';
import { TaxQuestionComponent } from '../tax-question/tax-question.component';
import { CollapsibleSectionComponent } from '../../../../shared/components/collapsible-section/collapsible-section.component';
import { OLD_REGIME_QUESTIONS, getQuestionCompletion, hasIncompleteAnswer } from '../../models/tax-question.model';
import type { QuestionCompletion, TaxQuestionAnswer, TaxQuestionId } from '../../models/tax-question.model';

@Component({
  selector: 'app-tax-questionnaire',
  standalone: true,
  imports: [TaxQuestionComponent, CollapsibleSectionComponent],
  templateUrl: './tax-questionnaire.component.html',
  styleUrl: './tax-questionnaire.component.scss',
})
export class TaxQuestionnaireComponent {
  answers = input.required<Record<TaxQuestionId, TaxQuestionAnswer>>();
  activeIndex = input<number>(0);
  expanded = model<boolean>(true);

  answersChange = output<Record<TaxQuestionId, TaxQuestionAnswer>>();
  activeIndexChange = output<number>();

  readonly questions = OLD_REGIME_QUESTIONS;

  activeQuestion = computed(() => this.questions[this.activeIndex()] ?? this.questions[0]);
  activeAnswer = computed(() => this.answers()[this.activeQuestion().id]);

  answeredCount = computed(
    () => Object.values(this.answers()).filter((a) => a.status !== 'not_visited').length,
  );

  hasIncomplete = computed(() => hasIncompleteAnswer(this.answers()));

  goTo(index: number): void {
    this.activeIndexChange.emit(index);
  }

  next(): void {
    this.goTo(Math.min(this.activeIndex() + 1, this.questions.length - 1));
  }

  previous(): void {
    this.goTo(Math.max(this.activeIndex() - 1, 0));
  }

  onAnswerChange(answer: TaxQuestionAnswer): void {
    this.answersChange.emit({ ...this.answers(), [answer.id]: answer });
  }

  completion(id: TaxQuestionId): QuestionCompletion {
    const answer = this.answers()[id];
    return answer ? getQuestionCompletion(answer) : 'not_visited';
  }

  statusMark(id: TaxQuestionId): string {
    switch (this.completion(id)) {
      case 'complete':
        return '✓';
      case 'incomplete':
        return '✗';
      case 'skipped':
        return '–';
      default:
        return '';
    }
  }
}
