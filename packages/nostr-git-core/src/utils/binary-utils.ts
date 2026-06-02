/**
 * Utility functions for handling binary data in file viewers and content pipelines
 * Moved from @nostr-git/ui to @nostr-git/core for cross-package reuse.
 */

/**
 * Convert a git-style binary string to a data: URL.
 * - Recovers bytes from a binary string (charCode & 0xff)
 * - Replaces unrecoverable U+FFFD with 0x00 to avoid corruption cascade
 * - Encodes to base64 using btoa when available, or Buffer fallback when present
 */
export function createDataUrl(content: string, mimeType: string): string {
  const bytes = binaryStringToBytes(content);
  const b64 = toBase64(bytes);
  return `data:${mimeType};base64,${b64}`;
}

/**
 * Convert a binary string into a Uint8Array, handling U+FFFD replacement chars.
 */
export function binaryStringToBytes(content: string): Uint8Array {
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) {
    const charCode = content.charCodeAt(i);
    // Handle Unicode replacement character (65533) as a best-effort fallback
    bytes[i] = charCode === 0xfffd /* 65533 */ ? 0x00 : charCode & 0xff;
  }
  return bytes;
}

/**
 * Encode bytes to base64 in a browser/mobile-friendly way.
 * Uses btoa when available; falls back to global Buffer if present.
 */
export function toBase64(bytes: Uint8Array): string {
  // Build a binary (latin1) string in chunks to avoid stack issues
  let binary = '';
  const chunk = 0x8000; // 32KB chunks
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, Array.from(sub) as any);
  }

  // Prefer btoa in browsers
  if (typeof btoa === 'function') {
    return btoa(binary);
  }

  // Safe fallback if Buffer is available (e.g., polyfilled in bundlers)
  const Buf: any = (globalThis as any).Buffer;
  if (Buf && typeof Buf.from === 'function') {
    return Buf.from(binary, 'binary').toString('base64');
  }

  throw new Error('No base64 encoder available in this environment');
}

/**
 * Convert a binary string to a Blob with the given mimeType.
 */
export function createBlob(content: string, mimeType: string): Blob {
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) {
    bytes[i] = content.charCodeAt(i) & 0xff;
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Heuristic check for binary-ness of a string (nulls or high ratio of non-printables).
 */
export function isBinaryContent(content: string): boolean {
  if (content.includes('\0')) return true;
  let nonPrintable = 0;
  const sampleSize = Math.min(content.length, 1000);
  for (let i = 0; i < sampleSize; i++) {
    const c = content.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c > 126) nonPrintable++;
  }
  return sampleSize > 0 && nonPrintable / sampleSize > 0.1;
}
