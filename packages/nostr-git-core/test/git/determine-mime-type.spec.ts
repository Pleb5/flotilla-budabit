import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { determineMimeType } from '../../src/git/git.js';

// We will stub fileTypeFromBuffer via module mock if needed, but here we
// exercise extension-only and default fallback paths (no data provided).

describe('determineMimeType extension and default fallbacks', () => {
  it('returns mapped mime for known extensions', async () => {
    expect(await determineMimeType(undefined, 'md')).toBe('text/markdown');
    expect(await determineMimeType(undefined, '.ts')).toBe('application/typescript');
    expect(await determineMimeType(undefined, 'png')).toBe('image/png');
    expect(await determineMimeType(undefined, 'woff2')).toBe('font/woff2');
    expect(await determineMimeType(undefined, 'zip')).toBe('application/zip');
  });

  it('returns octet-stream when no match', async () => {
    expect(await determineMimeType(undefined, 'unknownext')).toBe('application/octet-stream');
    expect(await determineMimeType()).toBe('application/octet-stream');
  });
});
