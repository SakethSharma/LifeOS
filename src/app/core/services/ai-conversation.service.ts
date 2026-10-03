import { Injectable, effect, inject, signal } from '@angular/core';
import { AiChatSession, initialChatState } from '../ai/ai-chat-session';
import type { ChatSessionState } from '../ai/ai-chat-session';
import { AiContextService } from './ai-context.service';
import { AiService } from './ai.service';

/**
 * The current AI Insights conversation, kept for the app session so it
 * survives a trip to Info (e.g. to connect AI) and back. In memory only:
 * closing the app or tapping Reset starts a new conversation.
 */
@Injectable({ providedIn: 'root' })
export class AiConversationService {
  private ai = inject(AiService);
  private aiContext = inject(AiContextService);

  readonly state = signal<ChatSessionState>(initialChatState());
  /** Unsent text in the composer. */
  readonly draft = signal('');

  readonly session = new AiChatSession(
    (history, message, attachments) => this.ai.chat(history, message, this.aiContext.build(), attachments),
    (state) => this.state.set(state),
  );

  constructor() {
    // Once the user connects, "AI isn't connected" no longer applies; their
    // unsent question stays so they can send it with one tap.
    effect(() => {
      if (this.ai.isConnected() && this.state().error === 'NOT_CONFIGURED') {
        this.session.clearError();
      }
    });

    // Disconnecting ends the conversation (it was with that provider).
    effect(() => {
      if (!this.ai.isConnected() && this.state().messages.length > 0 && this.state().error !== 'NOT_CONFIGURED') {
        this.reset();
      }
    });
  }

  /** Starts a new conversation. Keeps the AI connection, transactions, and all other data. */
  reset(): void {
    this.session.reset();
    this.draft.set('');
  }
}
