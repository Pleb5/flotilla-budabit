import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { createGitProvider } from '../../src/git/factory.js';

describe('git/factory createGitProvider', () => {
  it('returns a singleton provider instance', () => {
    const p1 = createGitProvider({ cacheMode: 'off' } as any);
    const p2 = createGitProvider({ cacheMode: 'off' } as any);
    expect(p1).toBe(p2);
    expect(typeof (p1 as any).listBranches).toBe('function');
  });

  it('provider is truthy and exposes basic git methods', () => {
    const p = createGitProvider() as any;
    expect(p).toBeTruthy();
    expect(typeof p.clone).toBe('function');
  });
});
