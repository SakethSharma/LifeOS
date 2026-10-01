import type { AiChatTurn, AiErrorCode } from './ai-contract';
import { AI_LIMITS } from './ai-contract';
import { toAiErrorCode } from './ai-errors';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatSessionState {
  messages: ChatMessage[];
  pending: boolean;
  error: AiErrorCode | null;
  /** Set while the last user message has no answer yet (failed); "Try Again" resends it. */
  unansweredPrompt: string | null;
}

/** Sends one turn to the AI. Receives earlier turns (oldest first) and the new message. */
export type ChatSender = (history: AiChatTurn[], message: string) => Promise<string>;

export function initialChatState(): ChatSessionState {
  return { messages: [], pending: false, error: null, unansweredPrompt: null };
}

/**
 * One in-memory AI conversation. Framework-free: the component mirrors
 * `state` into a signal via `onChange`. Holds only the user's words and the
 * AI's replies, never credentials or financial context.
 */
export class AiChatSession {
  private current = initialChatState();
  private nextId = 1;
  /** Bumped on reset so a reply that lands after a reset is dropped. */
  private generation = 0;

  constructor(
    private readonly sender: ChatSender,
    private readonly onChange: (state: ChatSessionState) => void = () => {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  get state(): ChatSessionState {
    return this.current;
  }

  canSend(text: string): boolean {
    const trimmed = text.trim();
    return !this.current.pending && trimmed.length > 0 && trimmed.length <= AI_LIMITS.maxMessageChars;
  }

  /** Adds the user's message and asks the AI. Returns false if the send was refused (empty/duplicate). */
  async send(text: string): Promise<boolean> {
    if (!this.canSend(text)) {
      return false;
    }

    const message = text.trim();
    const history = this.historyTurns();

    this.update({
      messages: [...this.current.messages, this.message('user', message)],
      pending: true,
      error: null,
      unansweredPrompt: null,
    });

    await this.ask(history, message);
    return true;
  }

  /** Resends the last unanswered message without duplicating it in the conversation. */
  async retry(): Promise<boolean> {
    const message = this.current.unansweredPrompt;

    if (!message || this.current.pending) {
      return false;
    }

    // History = everything before that unanswered user message.
    const history = this.historyTurns(this.current.messages.slice(0, -1));

    this.update({ ...this.current, pending: true, error: null });
    await this.ask(history, message);
    return true;
  }

  /**
   * Shows an error without calling the AI — e.g. "not connected" — keeping the
   * user's message so it can be sent once they've connected.
   */
  rejectWith(text: string, code: AiErrorCode): void {
    const message = text.trim();

    if (!message || this.current.pending) {
      return;
    }

    const alreadyShown = this.current.unansweredPrompt === message;

    this.update({
      messages: alreadyShown ? this.current.messages : [...this.current.messages, this.message('user', message)],
      pending: false,
      error: code,
      unansweredPrompt: message,
    });
  }

  clearError(): void {
    this.update({ ...this.current, error: null });
  }

  reset(): void {
    this.generation++;
    this.update(initialChatState());
  }

  private async ask(history: AiChatTurn[], message: string): Promise<void> {
    const generation = this.generation;

    try {
      const reply = (await this.sender(history, message)).trim();

      if (generation !== this.generation) return;

      if (!reply) {
        this.fail('EMPTY_RESPONSE', message);
        return;
      }

      this.update({
        messages: [...this.current.messages, this.message('assistant', reply)],
        pending: false,
        error: null,
        unansweredPrompt: null,
      });
    } catch (err) {
      if (generation !== this.generation) return;
      this.fail(toAiErrorCode(err), message);
    }
  }

  private fail(code: AiErrorCode, message: string): void {
    this.update({ ...this.current, pending: false, error: code, unansweredPrompt: message });
  }

  private historyTurns(messages = this.current.messages): AiChatTurn[] {
    const turns: AiChatTurn[] = [];

    // Only answered exchanges; an unanswered user message is dropped from history.
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const next = messages[i + 1];

      if (msg.role === 'user' && next?.role === 'assistant') {
        turns.push({ role: 'user', content: msg.content }, { role: 'assistant', content: next.content });
        i++;
      }
    }

    return turns.slice(-AI_LIMITS.maxHistoryTurns);
  }

  private message(role: ChatMessage['role'], content: string): ChatMessage {
    return { id: this.nextId++, role, content, timestamp: this.now().toISOString() };
  }

  private update(state: ChatSessionState): void {
    this.current = state;
    this.onChange(state);
  }
}
