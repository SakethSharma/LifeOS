/**
 * Seals a user's provider API key into an opaque token with AES-256-GCM, keyed
 * by the server-only AI_CREDENTIAL_SECRET. The app stores the token, never the
 * raw key, so a copied token is useless anywhere except this backend, and
 * rotating the secret revokes every token at once.
 *
 * Token format: "v1.<iv>.<ciphertext>" (base64url). The provider id is sealed
 * inside, so a token can't be replayed against a different provider.
 */
import type { AiProviderId } from '../../src/app/core/ai/ai-contract';
import { isAiProviderId } from '../../src/app/core/ai/ai-contract';

const VERSION = 'v1';
const MIN_SECRET_LENGTH = 32;
const IV_BYTES = 12;
const ADDITIONAL_DATA = new TextEncoder().encode('lifeos-ai-credential-v1');

export interface SealedCredential {
  provider: AiProviderId;
  apiKey: string;
}

export function isUsableSecret(secret: string | undefined): secret is string {
  return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH;
}

export async function sealCredential(credential: SealedCredential, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify({ p: credential.provider, k: credential.apiKey }));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: ADDITIONAL_DATA },
    key,
    plaintext,
  );

  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

/** Returns null for anything malformed, tampered with, or sealed under another secret. */
export async function openCredential(token: string, secret: string): Promise<SealedCredential | null> {
  const parts = token.split('.');

  if (parts.length !== 3 || parts[0] !== VERSION) {
    return null;
  }

  try {
    const key = await deriveKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(parts[1]), additionalData: ADDITIONAL_DATA },
      key,
      fromBase64Url(parts[2]),
    );

    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as { p?: unknown; k?: unknown };

    if (!isAiProviderId(parsed.p) || typeof parsed.k !== 'string' || !parsed.k) {
      return null;
    }

    return { provider: parsed.p, apiKey: parsed.k };
  } catch {
    return null;
  }
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, [
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('lifeos-ai-credential-salt'),
      info: new TextEncoder().encode('aes-256-gcm'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.from(text, 'base64url');
  const copy = new Uint8Array(new ArrayBuffer(bytes.length));
  copy.set(bytes);
  return copy;
}
