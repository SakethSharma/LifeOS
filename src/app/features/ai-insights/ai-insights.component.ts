import {
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { AiService } from "../../core/services/ai.service";
import { AiConversationService } from "../../core/services/ai-conversation.service";
import type { ChatAttachmentInput } from "../../core/ai/ai-chat-session";
import { AI_LIMITS } from "../../core/ai/ai-contract";
import type { AiContentBlock } from "../../core/ai/ai-contract";
import { describeAiError } from "../../core/ai/ai-errors";
import type { AiErrorAction } from "../../core/ai/ai-errors";
import { AI_CONNECT_FRAGMENT, AI_SETUP_ROUTE } from "../../core/ai/ai-provider-guides";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_RULES,
  UNREADABLE_FILE_MESSAGE,
  matchesSignature,
  readFileAsBase64,
  toContentBlock,
  validateNewAttachments,
} from "../../core/ai/chat-attachments";
import type { AttachmentKind } from "../../core/ai/chat-attachments";
import { AiStatusCardComponent } from "../../shared/components/ai-status-card/ai-status-card.component";

interface PendingAttachment {
  id: number;
  name: string;
  size: number;
  kind: AttachmentKind;
  /** Object URL for an image thumbnail; revoked when removed or sent. */
  previewUrl: string | null;
  block: AiContentBlock;
}

const MAX_INPUT_HEIGHT_PX = 168;

/**
 * Ask AI: a focused chat. Connection setup and all explanations live on the
 * Info page; this page only links there when AI isn't connected.
 */
@Component({
  selector: "app-ai-insights",
  standalone: true,
  templateUrl: "./ai-insights.component.html",
  styleUrl: "./ai-insights.component.scss",
  imports: [FormsModule, RouterLink, AiStatusCardComponent],
})
export class AiInsightsComponent implements OnDestroy {
  private ai = inject(AiService);
  private conversation = inject(AiConversationService);
  private router = inject(Router);
  private injector = inject(Injector);

  private promptInput = viewChild<ElementRef<HTMLTextAreaElement>>("promptInput");
  private fileInput = viewChild<ElementRef<HTMLInputElement>>("fileInput");
  private conversationEnd = viewChild<ElementRef<HTMLElement>>("conversationEnd");

  readonly setupRoute = AI_SETUP_ROUTE;
  readonly connectFragment = AI_CONNECT_FRAGMENT;
  readonly accept = CHAT_ATTACHMENT_ACCEPT;
  readonly maxFiles = CHAT_ATTACHMENT_RULES.maxFiles;
  readonly maxMessageChars = AI_LIMITS.maxMessageChars;
  readonly maxFileMb = Math.round(CHAT_ATTACHMENT_RULES.maxFileBytes / 1_000_000);

  isConnected = this.ai.isConnected;
  online = this.ai.online;
  chat = this.conversation.state;
  question = this.conversation.draft;

  attachments = signal<PendingAttachment[]>([]);
  attachmentErrors = signal<string[]>([]);
  readingFiles = signal(false);

  private nextAttachmentId = 1;

  hasConversation = computed(() => this.chat().messages.length > 0 || this.chat().error !== null);

  errorView = computed(() => {
    const code = this.chat().error;
    return code ? describeAiError(code) : null;
  });

  canAttachMore = computed(
    () => !this.chat().pending && !this.readingFiles() && this.attachments().length < this.maxFiles,
  );

  canSend = computed(() => {
    const text = this.question().trim();
    const hasFiles = this.attachments().length > 0;
    return (
      !this.chat().pending &&
      !this.readingFiles() &&
      text.length <= this.maxMessageChars &&
      (text.length > 0 || hasFiles)
    );
  });

  suggestedPrompts = [
    "Where did I spend the most money this month?",
    "Compare this month with last month",
    "Why did my savings change?",
    "Summarize my finances",
  ];

  constructor() {
    // Returning to an ongoing conversation: show the latest messages.
    if (this.chat().messages.length > 0) {
      this.scrollToLatest();
    }

    afterNextRender(() => this.resizeInput());
  }

  ngOnDestroy(): void {
    this.attachments().forEach((a) => releasePreview(a));
  }

  async submitPrompt(): Promise<void> {
    if (!this.canSend()) return;

    const text = this.question().trim();
    const files: ChatAttachmentInput[] = this.attachments().map((a) => ({ name: a.name, kind: a.kind, block: a.block }));

    this.clearComposer();

    if (!this.isConnected()) {
      this.conversation.session.rejectWith(text, "NOT_CONFIGURED", files);
      this.scrollToLatest();
      return;
    }

    const sending = this.conversation.session.send(text, files);
    this.scrollToLatest();
    await sending;
    this.scrollToLatest();
  }

  onPromptKeydown(event: KeyboardEvent): void {
    // Enter sends; Shift+Enter adds a new line; ignore IME composition.
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

    event.preventDefault();
    void this.submitPrompt();
  }

  onPromptInput(value: string): void {
    this.question.set(value);
    this.resizeInput();
  }

  usePrompt(prompt: string): void {
    this.question.set(prompt);
    this.afterRender(() => {
      this.resizeInput();
      this.promptInput()?.nativeElement.focus();
    });
  }

  openFilePicker(): void {
    if (this.canAttachMore()) {
      this.fileInput()?.nativeElement.click();
    }
  }

  async onFilesPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";

    if (files.length === 0) return;

    const { accepted, errors } = validateNewAttachments(
      this.attachments().map((a) => a.size),
      files,
    );

    this.readingFiles.set(true);

    for (const { file, kind, mediaType } of accepted) {
      try {
        const base64 = await readFileAsBase64(file);

        if (!matchesSignature(base64, mediaType)) {
          errors.push(UNREADABLE_FILE_MESSAGE(file.name));
          continue;
        }

        this.attachments.update((list) => [
          ...list,
          {
            id: this.nextAttachmentId++,
            name: file.name,
            size: file.size,
            kind,
            previewUrl: kind === "image" ? URL.createObjectURL(file) : null,
            block: toContentBlock(kind, mediaType, base64),
          },
        ]);
      } catch {
        errors.push(UNREADABLE_FILE_MESSAGE(file.name));
      }
    }

    this.readingFiles.set(false);
    this.attachmentErrors.set(errors);
  }

  removeAttachment(id: number): void {
    const target = this.attachments().find((a) => a.id === id);
    if (target) releasePreview(target);

    this.attachments.update((list) => list.filter((a) => a.id !== id));
    this.attachmentErrors.set([]);
  }

  dismissAttachmentErrors(): void {
    this.attachmentErrors.set([]);
  }

  async handleAction(action: AiErrorAction): Promise<void> {
    if (action === "retry") {
      await this.sendUnanswered();
    } else {
      await this.router.navigate([AI_SETUP_ROUTE], { fragment: AI_CONNECT_FRAGMENT });
    }
  }

  async sendUnanswered(): Promise<void> {
    const sending = this.conversation.session.retry();
    this.scrollToLatest();
    await sending;
    this.scrollToLatest();
  }

  /** New conversation. Keeps the AI connection, transactions, and all other data. */
  resetConversation(): void {
    this.conversation.reset();
    this.clearComposer();
    this.attachmentErrors.set([]);
  }

  formatSize(bytes: number): string {
    return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
  }

  private clearComposer(): void {
    this.attachments().forEach((a) => releasePreview(a));
    this.attachments.set([]);
    this.question.set("");
    this.afterRender(() => this.resizeInput());
  }

  /** Grows the textarea with its content, up to a cap, then it scrolls. */
  private resizeInput(): void {
    const el = this.promptInput()?.nativeElement;
    if (!el) return;

    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_INPUT_HEIGHT_PX ? "auto" : "hidden";
  }

  private scrollToLatest(): void {
    this.afterRender(() =>
      this.conversationEnd()?.nativeElement.scrollIntoView({ behavior: "smooth", block: "end" }),
    );
  }

  private afterRender(run: () => void): void {
    afterNextRender(run, { injector: this.injector });
  }
}

function releasePreview(attachment: PendingAttachment): void {
  if (attachment.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}
