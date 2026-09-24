// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { MAX_BINARY_BYTES, safeAssetUrl, verifyBinary } from './binary.js';

describe('binary verification', () => {
  it('checks exact bytes and size, rejects mismatch and oversized files', async () => {
    const file = new Blob(['test']);
    const hash = createHash('sha256').update('test').digest('hex');
    await expect(verifyBinary(file, hash, 4)).resolves.toBeUndefined();
    await expect(verifyBinary(file, hash, 5)).rejects.toThrow('size');
    await expect(verifyBinary(file, 'a'.repeat(64))).rejects.toThrow('mismatch');
    await expect(verifyBinary({ size: MAX_BINARY_BYTES + 1 } as Blob, hash)).rejects.toThrow(
      '512 MiB'
    );
    await expect(verifyBinary(file, 'invalid')).rejects.toThrow('Invalid');
  });
  it('allows HTTPS only, never executable schemes or URL credentials', () => {
    expect(safeAssetUrl('https://files.example/file')).toBe('https://files.example/file');
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,evil',
      'http://files.example',
      'https://user:pass@files.example',
      null,
    ])
      expect(safeAssetUrl(url)).toBeUndefined();
  });
});
