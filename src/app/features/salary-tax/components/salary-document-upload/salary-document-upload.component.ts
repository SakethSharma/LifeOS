import { Component, DestroyRef, computed, inject, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SalaryParserService } from '../../services/salary-parser.service';
import { AiDocumentService } from '../../services/ai-document.service';
import type { ExtractionFile } from '../../services/ai-document.service';
import { AiService } from '../../../../core/services/ai.service';
import { CollapsibleSectionComponent } from '../../../../shared/components/collapsible-section/collapsible-section.component';
import { AiStatusCardComponent } from '../../../../shared/components/ai-status-card/ai-status-card.component';
import { AI_LIMITS, OLLAMA_PROVIDER } from '../../../../core/ai/ai-contract';
import type { AiErrorCode } from '../../../../core/ai/ai-contract';
import { AiRequestError, describeAiError, isCancelled, toAiErrorCode } from '../../../../core/ai/ai-errors';
import type { AiErrorAction, AiErrorView } from '../../../../core/ai/ai-errors';
import { AI_CONNECT_FRAGMENT, AI_SETUP_ROUTE } from '../../../../core/ai/ai-provider-guides';
import type { DocumentExtractionResult } from '../../models/document-extraction.model';
import { isConfidentLocalParse } from '../../utils/tax-extraction.util';

type FileKind = 'text' | 'image' | 'pdf' | 'unsupported';

const TEXT_EXTENSIONS = ['.txt', '.csv', '.tsv'];
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const READ_ERROR = 'Could not read the file.';
const LOCAL_READER = 'LifeOS on this device';

/** Offline and "not connected" read differently here: manual entry always remains an option. */
const DOCUMENT_ERROR_OVERRIDES: Partial<Record<AiErrorCode, Partial<AiErrorView>>> = {
  OFFLINE: {
    title: "You're offline",
    message: 'Your AI provider needs an internet connection. You can still enter salary details manually.',
    action: 'manual',
    actionLabel: 'Enter Manually',
  },
  NOT_CONFIGURED: {
    title: "AI isn't connected yet",
    message:
      'Reading images, PDFs and salary details written in your own words needs an AI provider. Connect one on the Info page, or enter the details manually.',
    action: 'connect',
    actionLabel: 'Connect AI',
  },
};

@Component({
  selector: 'app-salary-document-upload',
  standalone: true,
  imports: [FormsModule, CollapsibleSectionComponent, AiStatusCardComponent],
  templateUrl: './salary-document-upload.component.html',
  styleUrl: './salary-document-upload.component.scss',
})
export class SalaryDocumentUploadComponent {
  private parser = inject(SalaryParserService);
  private aiDocument = inject(AiDocumentService);
  private router = inject(Router);
  private ai = inject(AiService);

  hasAlternativeProvider = this.ai.hasAlternativeProvider;

  expanded = model<boolean>(false);
  detected = output<DocumentExtractionResult>();
  enterManually = output<void>();

  aiAvailable = this.aiDocument.isAvailable;
  online = this.aiDocument.online;
  needsInternet = this.aiDocument.needsInternet;
  providerDescription = this.aiDocument.providerDescription;
  usingOllama = computed(() => this.aiDocument.activeProvider() === OLLAMA_PROVIDER);

  pasteText = signal('');
  /** The chosen file, held until the user confirms — nothing is sent on upload. */
  stagedFile = signal<File | null>(null);
  analyzing = signal(false);
  /** True after the user tapped Stop (shown as a note, not an error). */
  stopped = signal(false);
  /** Plain local problems (e.g. unsupported file type). */
  error = signal<string | null>(null);
  aiErrorCode = signal<AiErrorCode | null>(null);

  fileName = computed(() => this.stagedFile()?.name ?? null);
  canStart = computed(() => !this.analyzing() && (!!this.pasteText().trim() || !!this.stagedFile()));

  aiErrorView = computed<AiErrorView | null>(() => {
    const code = this.aiErrorCode();
    if (!code) return null;

    const view = { ...describeAiError(code), ...DOCUMENT_ERROR_OVERRIDES[code] };

    if (code === 'UNSUPPORTED_CAPABILITY' && this.usingOllama()) {
      return {
        ...view,
        title: "Ollama can't read this file",
        message:
          "Ollama can't read PDFs, and images need a vision model (e.g. llama3.2-vision). Paste the salary details as text instead, or switch to a cloud provider.",
      };
    }

    return view;
  });

  private inFlight: AbortController | null = null;
  /** Bumped by stop()/reset() so a result that arrives afterwards is dropped. */
  private generation = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.inFlight?.abort());
  }

  onPasteInput(text: string): void {
    this.pasteText.set(text);
    this.stopped.set(false);
  }

  /** Validates and stages a file. Processing starts only from "Let's Calculate Tax?". */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file || this.analyzing()) {
      return;
    }

    this.error.set(null);
    this.aiErrorCode.set(null);
    this.stopped.set(false);

    const kind = classifyFile(file);

    if (kind === 'unsupported') {
      this.error.set(
        `"${file.name}" isn't a supported file type yet. Please upload a PDF, image (JPG/PNG), CSV, or plain text file — or paste the content above instead.`,
      );
      return;
    }

    if (file.size === 0) {
      this.error.set(`"${file.name}" is empty. Please choose another file.`);
      return;
    }

    // Base64 grows files by about a third.
    if (kind !== 'text' && file.size * 1.37 > AI_LIMITS.maxExtractBase64Chars) {
      this.error.set(
        `"${file.name}" is too large to analyze (about 4 MB maximum). Try a smaller file or a screenshot of the salary section.`,
      );
      return;
    }

    this.stagedFile.set(file);
  }

  removeFile(): void {
    this.stagedFile.set(null);
    this.error.set(null);
    this.aiErrorCode.set(null);
  }

  /** "Let's Calculate Tax?" — the only thing that sends input anywhere. */
  async calculateTax(): Promise<void> {
    if (!this.canStart()) return;

    const text = this.pasteText().trim();
    const file = this.stagedFile();
    await this.runExtraction((cancel) => this.extract(text, file, cancel));
  }

  /** Stops processing: cancels the AI request and drops anything that arrives later. */
  stop(): void {
    if (!this.analyzing()) return;

    this.generation++;
    this.inFlight?.abort();
    this.inFlight = null;
    this.analyzing.set(false);
    this.stopped.set(true);
  }

  async onAiErrorAction(action: AiErrorAction): Promise<void> {
    switch (action) {
      case 'manual':
        this.aiErrorCode.set(null);
        this.enterManually.emit();
        break;
      case 'billing':
        this.ai.openBillingPage();
        break;
      case 'connect':
      case 'check-key':
      case 'switch-provider':
        await this.router.navigate([AI_SETUP_ROUTE], { fragment: AI_CONNECT_FRAGMENT });
        break;
      case 'retry':
        await this.calculateTax();
        break;
    }
  }

  /** Back to the initial state: nothing pasted, no file, no errors, collapsed. */
  reset(): void {
    this.generation++;
    this.inFlight?.abort();
    this.inFlight = null;
    this.pasteText.set('');
    this.stagedFile.set(null);
    this.error.set(null);
    this.aiErrorCode.set(null);
    this.analyzing.set(false);
    this.stopped.set(false);
    this.expanded.set(false);
  }

  private async extract(text: string, file: File | null, cancel: AbortSignal): Promise<DocumentExtractionResult> {
    const kind = file ? classifyFile(file) : null;
    let allText = text;

    if (file && kind === 'text') {
      const fileText = (await readAsText(file)).trim();
      if (!fileText && !text) {
        throw new Error(`"${file.name}" has no readable text.`);
      }
      allText = [text, fileText].filter(Boolean).join('\n\n');
    }

    const binary = file && (kind === 'image' || kind === 'pdf') ? file : null;

    // Plain "Label  Amount" text is read on this device; anything else goes to the selected AI provider.
    if (!binary) {
      const local = this.parser.parseText(allText);

      if (isConfidentLocalParse(allText, local)) {
        return { ...local, extractedBy: LOCAL_READER };
      }

      if (!this.aiAvailable()) {
        // Best effort without AI — flagged, because wording like "15 LPA" can't be read reliably here.
        const message =
          local.message ??
          'Without an AI provider, LifeOS can only read "Label  Amount" lines. Check every value below, or connect AI on the Info page.';
        return { ...local, message, extractedBy: LOCAL_READER };
      }
    } else if (!this.aiAvailable()) {
      throw new AiRequestError('NOT_CONFIGURED');
    }

    if (this.needsInternet() && !this.online()) {
      throw new AiRequestError('OFFLINE');
    }

    let extractionFile: ExtractionFile | undefined;

    if (binary) {
      extractionFile = {
        kind: kind === 'pdf' ? 'document' : 'image',
        mediaType: binary.type || (kind === 'pdf' ? 'application/pdf' : 'image/png'),
        base64Data: await readAsBase64(binary),
      };
    }

    return this.aiDocument.extract({ text: allText, file: extractionFile }, cancel);
  }

  private async runExtraction(run: (cancel: AbortSignal) => Promise<DocumentExtractionResult>): Promise<void> {
    const generation = ++this.generation;
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    this.error.set(null);
    this.aiErrorCode.set(null);
    this.stopped.set(false);
    this.analyzing.set(true);

    try {
      const result = await run(controller.signal);
      if (generation === this.generation) {
        this.detected.emit(result);
      }
    } catch (err) {
      if (generation !== this.generation || isCancelled(err)) return;

      if (err instanceof AiRequestError) {
        this.aiErrorCode.set(toAiErrorCode(err));
      } else if (err instanceof Error && err.message === READ_ERROR) {
        this.error.set('Could not read the file. Please try again or choose another file.');
      } else if (err instanceof Error && err.message.endsWith('has no readable text.')) {
        this.error.set(err.message);
      } else {
        this.aiErrorCode.set('UNKNOWN_ERROR');
      }
    } finally {
      if (generation === this.generation) {
        this.analyzing.set(false);
        this.inFlight = null;
      }
    }
  }
}

function classifyFile(file: File): FileKind {
  const lowerName = file.name.toLowerCase();

  if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return 'pdf';
  }

  if (IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|webp|gif)$/.test(lowerName)) {
    return 'image';
  }

  if (file.type.startsWith('text/') || TEXT_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    return 'text';
  }

  return 'unsupported';
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(READ_ERROR));
    reader.readAsText(file);
  });
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error(READ_ERROR));
    reader.readAsDataURL(file);
  });
}
