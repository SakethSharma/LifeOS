import type { AiChatTurn, AiContentBlock, AiErrorCode } from './ai-contract';
import { AI_LIMITS } from './ai-contract';
import type { AttachmentKind } from './chat-attachments';
import { toAiErrorCode } from './ai-errors';

/** What the conversation shows about a file — never its contents. */
export interface ChatAttachmentInfo {
  name: string;
  kind: AttachmentKind;
}

/** A file ready to send: display info plus the content block for the AI. */
export interface ChatAttachmentInput extends ChatAttachmentInfo {
  block: AiContentBlock;
}

export interface ChatMessage {
  id: number;
  /** "notice" lines (e.g. "Switched to Google Gemini") are shown in the chat but never sent to the AI. */
  role: 'user' | 'assistant' | 'notice';
  content: string;
  timestamp: string;
  attachments?: ChatAttachmentInfo[];
  /** Which provider wrote an assistant reply, e.g. "OpenAI API". */
  provider?: string;
}

export interface ChatSessionState {
  messages: ChatMessage[];
  pending: boolean;
  error: AiErrorCode | null;
  /** Set while the last user message has no answer yet (failed); "Try Again" resends it. */
  unansweredPrompt: string | null;
}

/** A reply, optionally naming the provider that wrote it. */
export type ChatReply = string | { text: string; provider?: string };

/**
 * Sends one turn to the AI. Receives earlier turns (oldest first), the new
 * message, its files, and a signal that aborts when the user taps Stop.
 */
export type ChatSender = (
  history: AiChatTurn[],
  message: string,
  attachments: AiContentBlock[],
  cancel: AbortSignal,
) => Promise<ChatReply>;

/** Shown in the conversation after the user stops a reply. */
export const STOPPED_NOTICE = 'Response stopped.';

/** Used when the user sends files without typing anything. */
export const ATTACHMENT_ONLY_PROMPT = 'Please look at the attached file(s) and explain anything relevant to my finances.';

export function initialChatState(): ChatSessionState {
  return { messages: [], pending: false, error: null, unansweredPrompt: null };
}

/**
 * One in-memory AI conversation. Framework-free: the component mirrors
 * `state` into a signal via `onChange`. Holds the user's words, file names,
 * and the AI's replies — never credentials or financial context. File data is
 * kept only until its message is answered (so "Try Again" can resend it).
 */
export class AiChatSession {
  private current = initialChatState();
  private nextId = 1;
  /** Bumped on reset so a reply that lands after a reset is dropped. */
  private generation = 0;
  private unansweredBlocks: AiContentBlock[] = [];
  /** Aborts the request in flight, if any. */
  private inFlight: AbortController | null = null;

  constructor(
    private readonly sender: ChatSender,
    private readonly onChange: (state: ChatSessionState) => void = () => {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  get state(): ChatSessionState {
    return this.current;
  }

  canSend(text: string, attachmentCount = 0): boolean {
    const trimmed = text.trim();

    if (this.current.pending || trimmed.length > AI_LIMITS.maxMessageChars) {
      return false;
    }

    return trimmed.length > 0 || attachmentCount > 0;
  }

  /** Adds the user's message and asks the AI. Returns false if the send was refused (empty/duplicate). */
  async send(text: string, attachments: ChatAttachmentInput[] = []): Promise<boolean> {
    if (!this.canSend(text, attachments.length)) {
      return false;
    }

    const message = text.trim() || ATTACHMENT_ONLY_PROMPT;
    const history = this.historyTurns();
    const blocks = attachments.map((a) => a.block);

    this.unansweredBlocks = blocks;
    this.update({
      messages: [...this.current.messages, this.message('user', message, attachments)],
      pending: true,
      error: null,
      unansweredPrompt: null,
    });

    await this.ask(history, message, blocks);
    return true;
  }

  /** Resends the last unanswered message (with its files) without duplicating it. */
  async retry(): Promise<boolean> {
    const message = this.current.unansweredPrompt;

    if (!message || this.current.pending) {
      return false;
    }

    // History = everything before that unanswered user message (notices after it don't matter).
    const lastUser = this.current.messages.map((m) => m.role).lastIndexOf('user');
    const history = this.historyTurns(this.current.messages.slice(0, lastUser));

    this.update({ ...this.current, pending: true, error: null });
    await this.ask(history, message, this.unansweredBlocks);
    return true;
  }

  /**
   * Shows an error without calling the AI — e.g. "not connected" — keeping the
   * user's message (and files) so it can be sent once they've connected.
   */
  rejectWith(text: string, code: AiErrorCode, attachments: ChatAttachmentInput[] = []): void {
    if (this.current.pending || (!text.trim() && attachments.length === 0)) {
      return;
    }

    const message = text.trim() || ATTACHMENT_ONLY_PROMPT;
    const alreadyShown = this.current.unansweredPrompt === message;

    if (!alreadyShown) {
      this.unansweredBlocks = attachments.map((a) => a.block);
    }

    this.update({
      messages: alreadyShown
        ? this.current.messages
        : [...this.current.messages, this.message('user', message, attachments)],
      pending: false,
      error: code,
      unansweredPrompt: message,
    });
  }

  /** Adds an informational line to the conversation (not sent to the AI). Ignored while a reply is pending. */
  addNotice(text: string): void {
    if (this.current.pending || this.current.messages.length === 0) {
      return;
    }

    this.update({ ...this.current, messages: [...this.current.messages, this.message('notice', text)] });
  }

  clearError(): void {
    this.update({ ...this.current, error: null });
  }

  /**
   * Stops the reply being generated: aborts the provider request, drops any
   * answer that still arrives, and keeps the user's message. Not an error.
   * Returns false when nothing was in progress.
   */
  stop(): boolean {
    if (!this.current.pending) {
      return false;
    }

    this.generation++;
    this.abortInFlight();
    this.unansweredBlocks = [];
    this.update({
      messages: [...this.current.messages, this.message('notice', STOPPED_NOTICE)],
      pending: false,
      error: null,
      unansweredPrompt: null,
    });
    return true;
  }

  reset(): void {
    this.generation++;
    this.abortInFlight();
    this.unansweredBlocks = [];
    this.update(initialChatState());
  }

  private abortInFlight(): void {
    this.inFlight?.abort();
    this.inFlight = null;
  }

  private async ask(history: AiChatTurn[], message: string, blocks: AiContentBlock[]): Promise<void> {
    const generation = this.generation;
    // One request at a time: anything older is aborted first.
    this.abortInFlight();
    const controller = new AbortController();
    this.inFlight = controller;

    try {
      const raw = await this.sender(history, message, blocks, controller.signal);
      const reply = (typeof raw === 'string' ? raw : raw.text).trim();
      const provider = typeof raw === 'string' ? undefined : raw.provider;

      if (generation !== this.generation) return;

      if (!reply) {
        this.fail('EMPTY_RESPONSE', message);
        return;
      }

      const answer = this.message('assistant', reply);
      if (provider) answer.provider = provider;

      this.unansweredBlocks = [];
      this.update({
        messages: [...this.current.messages, answer],
        pending: false,
        error: null,
        unansweredPrompt: null,
      });
    } catch (err) {
      if (generation !== this.generation || controller.signal.aborted) return;
      this.fail(toAiErrorCode(err), message);
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
    }
  }

  private fail(code: AiErrorCode, message: string): void {
    this.update({ ...this.current, pending: false, error: code, unansweredPrompt: message });
  }

  private historyTurns(all = this.current.messages): AiChatTurn[] {
    const turns: AiChatTurn[] = [];
    const messages = all.filter((m) => m.role !== 'notice');

    // Only answered exchanges; an unanswered user message is dropped from history.
    // Earlier files aren't resent — just named, so the AI knows they existed.
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const next = messages[i + 1];

      if (msg.role === 'user' && next?.role === 'assistant') {
        const names = msg.attachments?.map((a) => a.name).join(', ');
        const content = names ? `${msg.content}\n[Attached earlier: ${names}]` : msg.content;
        turns.push({ role: 'user', content }, { role: 'assistant', content: next.content });
        i++;
      }
    }

    return turns.slice(-AI_LIMITS.maxHistoryTurns);
  }

  private message(role: ChatMessage['role'], content: string, attachments: ChatAttachmentInput[] = []): ChatMessage {
    const message: ChatMessage = { id: this.nextId++, role, content, timestamp: this.now().toISOString() };

    if (attachments.length > 0) {
      message.attachments = attachments.map(({ name, kind }) => ({ name, kind }));
    }

    return message;
  }

  private update(state: ChatSessionState): void {
    this.current = state;
    this.onChange(state);
  }
}
