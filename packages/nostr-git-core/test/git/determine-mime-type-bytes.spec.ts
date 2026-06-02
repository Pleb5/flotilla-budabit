import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn(),
}));

const { determineMimeType } = await import('../../src/git/git.js');

describe('determineMimeType data-first path via file-type', () => {
  it('uses mime from fileTypeFromBuffer when available', async () => {
    const { fileTypeFromBuffer } = await import('file-type');
    (fileTypeFromBuffer as unknown as Mock).mockResolvedValue({ mime: 'image/png' });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(await determineMimeType(bytes)).toBe('image/png');
  });

  it('falls back to extension when fileTypeFromBuffer returns undefined', async () => {
    const { fileTypeFromBuffer } = await import('file-type');
    (fileTypeFromBuffer as unknown as Mock).mockResolvedValue(undefined as any);
    const bytes = new Uint8Array([0x00, 0x01]);
    expect(await determineMimeType(bytes, 'md')).toBe('text/markdown');
  });

  it('falls back to octet-stream when no data/extension match', async () => {
    const { fileTypeFromBuffer } = await import('file-type');
    (fileTypeFromBuffer as unknown as Mock).mockResolvedValue(undefined as any);
    const bytes = new Uint8Array([0x00, 0x01]);
    expect(await determineMimeType(bytes)).toBe('application/octet-stream');
  });
});
