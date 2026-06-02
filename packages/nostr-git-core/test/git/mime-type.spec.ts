import { describe, it, expect } from 'vitest';

import { determineMimeType } from '../../src/git/git.js';

describe('git/git.ts: determineMimeType', () => {
  it('detects image/png from buffer signature', async () => {
    // Minimal PNG header + IHDR chunk bytes (enough for file-type detection)
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89
    ]);

    const mime = await determineMimeType(png, '.png');
    expect(mime).toBe('image/png');
  });

  it('falls back to extension-based detection when buffer is unknown', async () => {
    const unknown = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const mime = await determineMimeType(unknown, 'md');
    expect(mime).toBe('text/markdown');
  });

  it('detects common extension-based types (md/js/pdf)', async () => {
    await expect(determineMimeType(undefined, '.md')).resolves.toBe('text/markdown');
    await expect(determineMimeType(undefined, 'js')).resolves.toBe('application/javascript');
    await expect(determineMimeType(undefined, '.pdf')).resolves.toBe('application/pdf');
  });

  it('returns application/octet-stream for unknown extension with no buffer type', async () => {
    const mime = await determineMimeType(undefined, '.nope');
    expect(mime).toBe('application/octet-stream');
  });
});