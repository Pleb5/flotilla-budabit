import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { makeRepoAddr, isRepoAddr } from '../../src/utils/repo-addr.js';

describe('utils/repo-addr', () => {
  it('makeRepoAddr builds correct address', () => {
    const pk = 'f'.repeat(64);
    const addr = makeRepoAddr(pk, 'my/repo');
    expect(addr).toBe(`30617:${pk}:my/repo`);
  });

  it('isRepoAddr validates correct and rejects invalid', () => {
    const pk = 'a'.repeat(64);
    const good = `30617:${pk}:repo`;
    const bads = [
      `30617:${pk.slice(0, 63)}:repo`, // short key
      `30617:Z${pk.slice(1)}:repo`,    // non-hex
      `99999:${pk}:repo`,              // wrong kind
      `30617:${pk}`                    // missing repo id
    ];
    expect(isRepoAddr(good)).toBe(true);
    for (const b of bads) expect(isRepoAddr(b)).toBe(false);
  });
});
