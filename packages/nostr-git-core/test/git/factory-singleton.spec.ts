import { describe, it, expect, vi } from 'vitest';
import { createGitProvider } from '../../src/git/factory.js';

describe('git/factory createGitProvider', () => {
  it('returns singleton instance across calls', async () => {
    vi.resetModules();
    const a = createGitProvider({ cacheMode: 'off' });
    const b = createGitProvider({ cacheMode: 'off' });
    expect(a).toBe(b);
  });

  it('honors cacheMode=off => IsomorphicGitProvider instance', async () => {
    vi.resetModules();
    const { createGitProvider } = await import('../../src/git/factory.js');
    const { IsomorphicGitProvider } = await import('../../src/git/isomorphic-git-provider.js');
    const p = createGitProvider({ cacheMode: 'off' });
    expect(p instanceof IsomorphicGitProvider).toBe(true);
  });

  it('default cache mode wraps Isomorphic in CachedGitProvider', async () => {
    vi.resetModules();
    const { createGitProvider } = await import('../../src/git/factory.js');
    const { CachedGitProvider } = await import('../../src/git/cached-provider.js');
    const { IsomorphicGitProvider } = await import('../../src/git/isomorphic-git-provider.js');
    const p = createGitProvider();
    expect(p instanceof CachedGitProvider).toBe(true);
    // baseProvider should be an IsomorphicGitProvider
    expect((p as any).baseProvider instanceof IsomorphicGitProvider).toBe(true);
  });
});
