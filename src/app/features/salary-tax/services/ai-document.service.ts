import { Injectable, computed, inject } from '@angular/core';
import { AiService } from '../../../core/services/ai.service';
import type { AiContentBlock } from '../../../core/ai/ai-contract';
import { unsupportedAttachmentKinds } from '../../../core/ai/ai-contract';
import { AiRequestError } from '../../../core/ai/ai-errors';
import { isCloudProvider, providerShortName } from '../../../core/ai/ai-provider-guides';
import type { DocumentExtractionResult } from '../models/document-extraction.model';
import { flagUnverifiedAmounts, parseExtractionResponse } from '../utils/tax-extraction.util';

/** One file for the AI: an image or a PDF, already base64-encoded. */
export interface ExtractionFile {
  kind: 'image' | 'document';
  mediaType: string;
  base64Data: string;
}

/**
 * AI-backed extraction for inputs the local parser can't handle — prose,
 * images, and PDFs. Uses the app-wide AI provider selection (the same one AI
 * Insights uses), so Ollama, OpenAI, Gemini or Anthropic answer according to
 * the user's choice. Structured output only; the tax engine remains the sole
 * source of truth for every calculated number.
 */
@Injectable({ providedIn: 'root' })
export class AiDocumentService {
  private ai = inject(AiService);

  readonly isAvailable = this.ai.isConnected;
  readonly online = this.ai.online;
  readonly activeProvider = this.ai.activeProvider;

  /** Cloud providers need internet; Ollama runs on this computer. */
  readonly needsInternet = computed(() => isCloudProvider(this.ai.activeProvider()));

  /** e.g. "Ollama · llama3.2:latest" — shown so users know AI read their input. */
  readonly providerDescription = computed(() => {
    const c = this.ai.connection();
    return c ? providerShortName(c.provider) + (c.model ? ` · ${c.model}` : '') : '';
  });

  /** Sends pasted text and/or one file to the selected provider in a single request. */
  async extract(input: { text?: string; file?: ExtractionFile }, cancel?: AbortSignal): Promise<DocumentExtractionResult> {
    const blocks: AiContentBlock[] = [];

    if (input.file) {
      blocks.push({ type: input.file.kind, mediaType: input.file.mediaType, base64Data: input.file.base64Data });
    }

    if (input.text?.trim()) {
      blocks.push({ type: 'text', text: input.text.trim() });
    }

    const provider = this.ai.activeProvider();

    // Say so up front (e.g. Ollama can't read PDFs) instead of sending a request that can't work.
    if (provider && unsupportedAttachmentKinds(provider, blocks).length > 0) {
      throw new AiRequestError('UNSUPPORTED_CAPABILITY');
    }

    const extractedBy = this.providerDescription();
    const raw = await this.ai.extract('salary_document', blocks, cancel);
    let result = parseExtractionResponse(raw);

    // Typed text can be checked: every amount must be one the user actually wrote.
    if (!input.file && input.text?.trim()) {
      result = flagUnverifiedAmounts(result, input.text);
    }

    return extractedBy ? { ...result, extractedBy } : result;
  }
}
