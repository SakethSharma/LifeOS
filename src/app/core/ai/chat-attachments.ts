import type { AiContentBlock } from './ai-contract';
import { AI_LIMITS } from './ai-contract';

export type AttachmentKind = 'image' | 'pdf';

interface AllowedType {
  mediaType: string;
  extensions: string[];
  kind: AttachmentKind;
  /** Start of the base64 data for a genuine file of this type. */
  base64Signatures: string[];
}

/**
 * Chat attachment rules — change them here. The total is kept under the AI
 * backend's request limit (base64 makes files about a third larger).
 */
export const CHAT_ATTACHMENT_RULES = {
  maxFiles: AI_LIMITS.maxChatAttachments,
  maxFileBytes: 4_000_000,
  maxTotalBytes: 4_000_000,
  allowedTypes: [
    { mediaType: 'image/png', extensions: ['.png'], kind: 'image', base64Signatures: ['iVBORw0KGgo'] },
    { mediaType: 'image/jpeg', extensions: ['.jpg', '.jpeg'], kind: 'image', base64Signatures: ['/9j/'] },
    { mediaType: 'image/webp', extensions: ['.webp'], kind: 'image', base64Signatures: ['UklGR'] },
    { mediaType: 'image/gif', extensions: ['.gif'], kind: 'image', base64Signatures: ['R0lGOD'] },
    { mediaType: 'application/pdf', extensions: ['.pdf'], kind: 'pdf', base64Signatures: ['JVBER'] },
  ] as AllowedType[],
};

/** For the file picker's `accept` attribute. */
export const CHAT_ATTACHMENT_ACCEPT = CHAT_ATTACHMENT_RULES.allowedTypes
  .flatMap((t) => [t.mediaType, ...t.extensions])
  .join(',');

export interface FileMeta {
  name: string;
  size: number;
  type: string;
}

export interface AcceptedFile<F extends FileMeta = FileMeta> {
  file: F;
  kind: AttachmentKind;
  mediaType: string;
}

export interface AttachmentValidation<F extends FileMeta = FileMeta> {
  accepted: AcceptedFile<F>[];
  errors: string[];
}

const MB = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

export function classifyAttachment(meta: FileMeta): { kind: AttachmentKind; mediaType: string } | null {
  const lower = meta.name.toLowerCase();
  const byType = CHAT_ATTACHMENT_RULES.allowedTypes.find((t) => t.mediaType === meta.type);
  const byExtension = CHAT_ATTACHMENT_RULES.allowedTypes.find((t) => t.extensions.some((ext) => lower.endsWith(ext)));
  const match = byType ?? (meta.type === '' || meta.type === 'application/octet-stream' ? byExtension : undefined);

  return match ? { kind: match.kind, mediaType: match.mediaType } : null;
}

/**
 * Checks newly picked files against the rules, given the sizes already
 * attached. Every rejected file produces a message — nothing is dropped silently.
 */
export function validateNewAttachments<F extends FileMeta>(
  alreadyAttachedSizes: number[],
  incoming: F[],
): AttachmentValidation<F> {
  const rules = CHAT_ATTACHMENT_RULES;
  const accepted: AcceptedFile<F>[] = [];
  const errors: string[] = [];
  let count = alreadyAttachedSizes.length;
  let total = alreadyAttachedSizes.reduce((sum, size) => sum + size, 0);

  for (const file of incoming) {
    const type = classifyAttachment(file);

    if (!type) {
      errors.push(`"${file.name}": this file type is not supported. Attach an image (PNG, JPG, WebP, GIF) or a PDF.`);
      continue;
    }

    if (file.size === 0) {
      errors.push(`"${file.name}" is empty. Please choose another file.`);
      continue;
    }

    if (file.size > rules.maxFileBytes) {
      errors.push(`"${file.name}" is too large. Please choose a file under ${MB(rules.maxFileBytes)}.`);
      continue;
    }

    if (count >= rules.maxFiles) {
      errors.push(`You can attach up to ${rules.maxFiles} files per message.`);
      break;
    }

    if (total + file.size > rules.maxTotalBytes) {
      errors.push(`"${file.name}" would make this message too large (${MB(rules.maxTotalBytes)} in total). Remove a file or choose a smaller one.`);
      continue;
    }

    accepted.push({ file, ...type });
    count++;
    total += file.size;
  }

  return { accepted, errors };
}

/** True when the bytes actually look like the claimed type (catches renamed or corrupt files). */
export function matchesSignature(base64: string, mediaType: string): boolean {
  const type = CHAT_ATTACHMENT_RULES.allowedTypes.find((t) => t.mediaType === mediaType);
  return !!type && base64.length > 0 && type.base64Signatures.some((sig) => base64.startsWith(sig));
}

export function toContentBlock(kind: AttachmentKind, mediaType: string, base64Data: string): AiContentBlock {
  return kind === 'pdf' ? { type: 'document', mediaType, base64Data } : { type: 'image', mediaType, base64Data };
}

export const UNREADABLE_FILE_MESSAGE = (name: string) => `Unable to read "${name}". Please try another one.`;

/** Browser-only: reads a file as bare base64 (no data: prefix). */
export function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? '' : result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('unreadable'));
    reader.readAsDataURL(file);
  });
}
