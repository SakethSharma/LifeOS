import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { AiChatSession, initialChatState } from '../ai/ai-chat-session';
import type { ChatSessionState } from '../ai/ai-chat-session';
import type { AiProviderChoice } from '../ai/ai-contract';
import { isCloudProvider, providerShortName } from '../ai/ai-provider-guides';
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
    async (history, message, attachments, cancel) => {
      const reply = await this.ai.chatWithProvider(history, message, this.aiContext.build(), attachments, cancel);
      const model = this.ai.connections()[reply.provider]?.model;
      const name = providerShortName(reply.provider);
      return { text: reply.text, provider: model ? `${name} · ${model}` : name };
    },
    (state) => this.state.set(state),
  );

  private previousActive: AiProviderChoice | null = this.ai.activeProvider();

  constructor() {
    // Once the user connects, "AI isn't connected" no longer applies; their
    // unsent question stays so they can send it with one tap.
    effect(() => {
      if (this.ai.isConnected() && this.state().error === 'NOT_CONFIGURED') {
        this.session.clearError();
      }
    });

    // Removing every provider ends the conversation. A single failing key
    // doesn't — the error (and the option to switch) stays visible.
    effect(() => {
      const noneConfigured = Object.keys(this.ai.connections()).length === 0;
      const state = this.state();

      if (noneConfigured && state.messages.length > 0 && state.error !== 'NOT_CONFIGURED') {
        untracked(() => this.reset());
      }
    });

    // Make provider switches visible in the chat. Earlier messages are sent
    // along as context, so say so rather than implying a fresh start.
    effect(() => {
      const active = this.ai.activeProvider();
      const previous = this.previousActive;
      this.previousActive = active;

      if (active && previous && active !== previous) {
        const name = providerShortName(active);
        const where = isCloudProvider(active) ? `shared with ${name}` : `sent to ${name} on your device`;
        untracked(() => this.session.addNotice(`Switched to ${name}. Earlier messages in this chat are ${where} as context.`));
      }
    });
  }

  /** Starts a new conversation. Keeps the AI connections, transactions, and all other data. */
  reset(): void {
    this.session.reset();
    this.draft.set('');
  }
}
