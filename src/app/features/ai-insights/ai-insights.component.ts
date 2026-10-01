import { Component, ElementRef, OnInit, computed, effect, inject, signal, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { AiService } from "../../core/services/ai.service";
import { AiContextService } from "../../core/services/ai-context.service";
import { AiChatSession } from "../../core/ai/ai-chat-session";
import type { ChatSessionState } from "../../core/ai/ai-chat-session";
import type { AiProviderId } from "../../core/ai/ai-contract";
import { AI_LIMITS } from "../../core/ai/ai-contract";
import { describeAiError } from "../../core/ai/ai-errors";
import type { AiErrorAction, AiErrorView } from "../../core/ai/ai-errors";
import { AI_CONNECT_FRAGMENT, getProviderInfo } from "../../core/ai/ai-provider-guides";
import { AiStatusCardComponent } from "../../shared/components/ai-status-card/ai-status-card.component";
import { CollapsibleSectionComponent } from "../../shared/components/collapsible-section/collapsible-section.component";
import { AiConnectionPanelComponent } from "./components/ai-connection-panel/ai-connection-panel.component";
import { AiSetupCarouselComponent } from "./components/ai-setup-carousel/ai-setup-carousel.component";

const NOT_CONNECTED_VIEW: AiErrorView = {
  code: "NOT_CONFIGURED",
  icon: "✦",
  title: "AI is not connected yet",
  message: "Connect an AI provider to ask LifeOS questions and receive AI-powered insights.",
  action: "connect",
  actionLabel: "Connect AI",
};

@Component({
  selector: "app-ai-insights",
  standalone: true,
  templateUrl: "./ai-insights.component.html",
  styleUrl: "./ai-insights.component.scss",
  imports: [
    FormsModule,
    AiStatusCardComponent,
    CollapsibleSectionComponent,
    AiConnectionPanelComponent,
    AiSetupCarouselComponent,
  ],
})
export class AiInsightsComponent implements OnInit {
  private ai = inject(AiService);
  private aiContext = inject(AiContextService);
  private route = inject(ActivatedRoute);

  private setupSection = viewChild<ElementRef<HTMLElement>>("setupSection");
  private connectionPanel = viewChild(AiConnectionPanelComponent);
  private conversationEnd = viewChild<ElementRef<HTMLElement>>("conversationEnd");

  readonly notConnectedView = NOT_CONNECTED_VIEW;
  readonly maxMessageChars = AI_LIMITS.maxMessageChars;

  isConnected = this.ai.isConnected;
  connection = this.ai.connection;
  connectionStatus = this.ai.status;
  online = this.ai.online;

  question = signal("");
  chat = signal<ChatSessionState>({ messages: [], pending: false, error: null, unansweredPrompt: null });

  /** The setup section stays open while the user is working in it, even after connecting. */
  setupOpen = signal(!this.ai.isConnected());
  guideExpanded = signal(false);
  guideProvider = signal<AiProviderId>(this.ai.connection()?.provider ?? "openai");

  private session = new AiChatSession(
    (history, message) => this.ai.chat(history, message, this.aiContext.build()),
    (state) => this.chat.set(state),
  );

  showSetup = computed(() => !this.isConnected() || this.setupOpen());
  connectedProviderLabel = computed(() => {
    const c = this.connection();
    return c ? getProviderInfo(c.provider).label : "";
  });

  errorView = computed(() => {
    const code = this.chat().error;
    return code ? describeAiError(code) : null;
  });

  canSend = computed(() => {
    const text = this.question().trim();
    return !this.chat().pending && text.length > 0 && text.length <= this.maxMessageChars;
  });

  hasConversation = computed(() => this.chat().messages.length > 0 || this.chat().error !== null);

  badge = computed(() => {
    const status = this.connectionStatus();

    if (status.state === "testing") return { cls: "testing", text: "Connecting…" };
    if (!this.isConnected()) return { cls: "", text: "AI Not Connected" };
    if (status.state === "error") return { cls: "issue", text: "AI Connection Issue" };
    return { cls: "ai-on", text: "AI Connected" };
  });

  suggestedPrompts = [
    "Where did I spend the most money this month?",
    "Compare this month with last month",
    "Why did my savings change?",
    "Summarize my finances",
  ];

  constructor() {
    // Once the user connects, an "AI isn't connected" error no longer applies;
    // their unsent question stays so they can send it with one tap.
    effect(() => {
      if (this.isConnected() && this.chat().error === "NOT_CONFIGURED") {
        this.session.clearError();
      }
    });
  }

  ngOnInit(): void {
    if (this.route.snapshot.fragment === AI_CONNECT_FRAGMENT) {
      this.openSetup({ guide: !this.isConnected(), changeKey: false });
    }
  }

  async submitPrompt(): Promise<void> {
    const text = this.question().trim();

    if (!text || this.chat().pending) return;

    this.question.set("");

    if (!this.isConnected()) {
      this.session.rejectWith(text, "NOT_CONFIGURED");
      return;
    }

    await this.session.send(text);
    this.scrollToLatest();
  }

  onPromptEnter(event: Event): void {
    const keyEvent = event as KeyboardEvent;

    // Shift+Enter inserts a newline; Enter submits. Ignore IME composition.
    if (keyEvent.shiftKey || keyEvent.isComposing) return;

    keyEvent.preventDefault();
    this.submitPrompt();
  }

  usePrompt(prompt: string): void {
    this.question.set(prompt);
  }

  async sendUnanswered(): Promise<void> {
    await this.session.retry();
    this.scrollToLatest();
  }

  async handleAction(action: AiErrorAction): Promise<void> {
    switch (action) {
      case "connect":
        this.openSetup({ guide: true, changeKey: false });
        break;
      case "check-key":
        this.openSetup({ guide: false, changeKey: true });
        break;
      case "retry":
        await this.sendUnanswered();
        break;
      case "manual":
        break;
    }
  }

  /** Starts a new conversation. Keeps the AI connection, transactions and all other data. */
  resetConversation(): void {
    this.session.reset();
    this.question.set("");
  }

  openSetup(options: { guide: boolean; changeKey: boolean }): void {
    this.setupOpen.set(true);

    if (options.guide) {
      this.guideExpanded.set(true);
    }

    // Wait for the section to render before scrolling to it.
    setTimeout(() => {
      this.setupSection()?.nativeElement.scrollIntoView({ behavior: "smooth", block: "start" });
      this.connectionPanel()?.focusForSetup(options.changeKey);
    });
  }

  openGuide(): void {
    this.guideExpanded.set(true);
  }

  closeSetup(): void {
    this.setupOpen.set(false);
  }

  onDisconnected(): void {
    this.resetConversation();
    this.guideExpanded.set(false);
  }

  private scrollToLatest(): void {
    setTimeout(() => this.conversationEnd()?.nativeElement.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }
}
