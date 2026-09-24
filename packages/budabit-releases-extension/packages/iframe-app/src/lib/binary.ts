import { sha256 } from '@noble/hashes/sha2.js';
import { HEX_KEY } from './context.js';

export const MAX_BINARY_BYTES = 512 * 1024 * 1024;
export function safeAssetUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** Incremental hashing keeps memory bounded. Never executes or uploads the selected file. */
export async function verifyBinary(
  file: Blob,
  expectedHash: string,
  expectedSize?: number
): Promise<void> {
  if (!HEX_KEY.test(expectedHash)) throw new Error('Invalid SHA-256');
  if (file.size > MAX_BINARY_BYTES) throw new Error('File exceeds the 512 MiB verification limit');
  if (expectedSize !== undefined && file.size !== expectedSize)
    throw new Error('File size does not match signed metadata');
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
    hash.update(new Uint8Array(await file.slice(offset, offset + 1024 * 1024).arrayBuffer()));
  }
  const actual = [...hash.digest()].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (actual !== expectedHash) throw new Error('SHA-256 mismatch: do not use this file');
}
