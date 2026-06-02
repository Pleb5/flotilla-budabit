import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { binaryStringToBytes, toBase64, createDataUrl, createBlob, isBinaryContent } from '../../src/utils/binary-utils.js';

describe('utils/binary-utils', () => {
  it('binaryStringToBytes maps U+FFFD to 0x00 and preserves low bytes', () => {
    const s = String.fromCharCode(0x41) + String.fromCharCode(0xfffd) + String.fromCharCode(0x00ff);
    const bytes = binaryStringToBytes(s);
    expect(Array.from(bytes)).toEqual([0x41, 0x00, 0xff]);
  });

  it('toBase64 throws when no encoder available', () => {
    const bytes = new Uint8Array([1,2,3]);
    const oldBtoa: any = (globalThis as any).btoa;
    const oldBuf: any = (globalThis as any).Buffer;
    (globalThis as any).btoa = undefined as any;
    (globalThis as any).Buffer = undefined as any;
    try {
      expect(() => toBase64(bytes)).toThrow(/No base64 encoder available/);
    } finally {
      (globalThis as any).btoa = oldBtoa;
      (globalThis as any).Buffer = oldBuf;
    }
  });

  it('toBase64 uses btoa when available', () => {
    const bytes = new Uint8Array([0x4d, 0x41, 0x4e]); // MAN
    const oldBtoa: any = (globalThis as any).btoa;
    (globalThis as any).btoa = (str: string) => {
      // very small custom btoa for ASCII input
      // reuse Buffer to avoid re-implementing; this still exercises the btoa code path
      // eslint-disable-next-line no-undef
      return (globalThis as any).Buffer.from(str, 'binary').toString('base64');
    };
    try {
      const b64 = toBase64(bytes);
      expect(b64).toBe('TUFO');
    } finally {
      (globalThis as any).btoa = oldBtoa;
    }
  });

  it('toBase64 encodes bytes using Buffer fallback when btoa is absent', () => {
    const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // Hello
    // Ensure btoa absent so Buffer path is taken
    const oldBtoa: any = (globalThis as any).btoa;
    (globalThis as any).btoa = undefined as any;
    try {
      const b64 = toBase64(bytes);
      expect(b64).toBe('SGVsbG8=');
    } finally {
      (globalThis as any).btoa = oldBtoa;
    }
  });

  it('createDataUrl builds data URL with base64 content', () => {
    const s = 'Hello';
    const url = createDataUrl(s, 'text/plain');
    expect(url.startsWith('data:text/plain;base64,')).toBe(true);
    expect(url.endsWith('SGVsbG8=')).toBe(true);
  });

  it('createBlob returns Blob with correct type and length', () => {
    const s = 'ABC';
    const blob = createBlob(s, 'application/octet-stream');
    expect(blob.size).toBe(3);
    expect(blob.type).toBe('application/octet-stream');
  });

  it('isBinaryContent detects binary-like strings (nulls or many non-printables)', () => {
    expect(isBinaryContent('plain ascii text')) .toBe(false);
    expect(isBinaryContent('has\u0000null')).toBe(true);
    const noisy = String.fromCharCode(1) + String.fromCharCode(2) + 'A'.repeat(10);
    expect(isBinaryContent(noisy)).toBe(true);
  });
});
