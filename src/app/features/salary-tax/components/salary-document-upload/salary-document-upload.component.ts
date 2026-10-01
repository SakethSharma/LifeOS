import { Component, computed, inject, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SalaryParserService } from '../../services/salary-parser.service';
import { AiDocumentService } from '../../services/ai-document.service';
import { CollapsibleSectionComponent } from '../../../../shared/components/collapsible-section/collapsible-section.component';
import { AiStatusCardComponent } from '../../../../shared/components/ai-status-card/ai-status-card.component';
import { AI_LIMITS } from '../../../../core/ai/ai-contract';
import type { AiErrorCode } from '../../../../core/ai/ai-contract';
import { AiRequestError, describeAiError, toAiErrorCode } from '../../../../core/ai/ai-errors';
import type { AiErrorAction, AiErrorView } from '../../../../core/ai/ai-errors';
import { AI_CONNECT_FRAGMENT } from '../../../../core/ai/ai-provider-guides';
import type { DocumentExtractionResult } from '../../models/document-extraction.model';

type FileKind = 'text' | 'image' | 'pdf' | 'unsupported';

const TEXT_EXTENSIONS = ['.txt', '.csv', '.tsv'];
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const READ_ERROR = 'Could not read the file.';

/** Offline and "not connected" read differently here: manual entry always remains an option. */
const DOCUMENT_ERROR_OVERRIDES: Partial<Record<AiErrorCode, Partial<AiErrorView>>> = {
  OFFLINE: {
    title: "You're offline",
    message: 'AI document analysis requires an internet connection. You can still enter salary details manually.',
    action: 'manual',
    actionLabel: 'Enter Manually',
  },
  NOT_CONFIGURED: {
    title: "AI isn't connected yet",
    message:
      'Reading images and PDFs needs an AI provider. Connect one once in AI Insights, or paste the details as text or enter them manually.',
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

  expanded = model<boolean>(false);
  detected = output<DocumentExtractionResult>();
  enterManually = output<void>();

  aiAvailable = this.aiDocument.isAvailable;
  online = this.aiDocument.online;

  pasteText = signal('');
  analyzing = signal(false);
  /** Plain local problems (e.g. unsupported file type). */
  error = signal<string | null>(null);
  aiErrorCode = signal<AiErrorCode | null>(null);
  fileName = signal<string | null>(null);

  aiErrorView = computed<AiErrorView | null>(() => {
    const code = this.aiErrorCode();
    return code ? { ...describeAiError(code), ...DOCUMENT_ERROR_OVERRIDES[code] } : null;
  });

  private lastRun: (() => Promise<DocumentExtractionResult>) | null = null;
  /** Bumped by reset() so a result that arrives afterwards is dropped. */
  private generation = 0;

  async analyzePaste(): Promise<void> {
    const text = this.pasteText().trim();

    if (!text || this.analyzing()) {
      return;
    }

    this.fileName.set(null);
    await this.runExtraction(() => this.extractFromText(text));
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file || this.analyzing()) {
      return;
    }

    this.fileName.set(file.name);
    this.aiErrorCode.set(null);

    const kind = classifyFile(file);

    if (kind === 'unsupported') {
      this.error.set(
        `"${file.name}" isn't a supported file type yet. Please upload a PDF, image (JPG/PNG), CSV, or plain text file — or paste the content above instead.`,
      );
      return;
    }

    // Base64 grows files by about a third.
    if (kind !== 'text' && file.size * 1.37 > AI_LIMITS.maxExtractBase64Chars) {
      this.error.set(
        `"${file.name}" is too large to analyze (about 4 MB maximum). Try a smaller file or a screenshot of the salary section.`,
      );
      return;
    }

    await this.runExtraction(async () => {
      if (kind === 'text') {
        const text = await readAsText(file);
        return this.extractFromText(text);
      }

      if (!this.aiAvailable()) {
        throw new AiRequestError('NOT_CONFIGURED');
      }

      if (!this.online()) {
        throw new AiRequestError('OFFLINE');
      }

      const base64Data = await readAsBase64(file);
      const mediaType = file.type || (kind === 'pdf' ? 'application/pdf' : 'image/png');

      return this.aiDocument.extractFromFile(base64Data, mediaType, kind === 'pdf' ? 'document' : 'image');
    });
  }

  async onAiErrorAction(action: AiErrorAction): Promise<void> {
    switch (action) {
      case 'manual':
        this.aiErrorCode.set(null);
        this.enterManually.emit();
        break;
      case 'connect':
      case 'check-key':
        await this.router.navigate(['/ai-insights'], { fragment: AI_CONNECT_FRAGMENT });
        break;
      case 'retry':
        if (this.lastRun) {
          await this.runExtraction(this.lastRun);
        }
        break;
    }
  }

  /** Back to the initial state: nothing pasted, no file, no errors, collapsed. */
  reset(): void {
    this.generation++;
    this.pasteText.set('');
    this.fileName.set(null);
    this.error.set(null);
    this.aiErrorCode.set(null);
    this.analyzing.set(false);
    this.lastRun = null;
    this.expanded.set(false);
  }

  private async extractFromText(text: string): Promise<DocumentExtractionResult> {
    const local = this.parser.parseText(text);

    // Local parsing works offline and without AI; AI is only a fallback.
    if ((local.isRelevant && local.fields.length > 0) || !this.aiAvailable()) {
      return local;
    }

    return this.aiDocument.extractFromText(text);
  }

  private async runExtraction(run: () => Promise<DocumentExtractionResult>): Promise<void> {
    const generation = this.generation;

    this.lastRun = run;
    this.error.set(null);
    this.aiErrorCode.set(null);
    this.analyzing.set(true);

    try {
      const result = await run();
      if (generation === this.generation) {
        this.detected.emit(result);
      }
    } catch (err) {
      if (generation !== this.generation) return;

      if (err instanceof Error && err.message === READ_ERROR) {
        this.error.set('Could not read the file. Please try again or choose another file.');
      } else {
        this.aiErrorCode.set(toAiErrorCode(err));
      }
    } finally {
      if (generation === this.generation) {
        this.analyzing.set(false);
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
