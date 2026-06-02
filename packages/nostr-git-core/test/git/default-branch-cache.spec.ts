import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';

import { getDefaultBranch } from '../../src/git/git.js';

vi.mock('../../src/api/git-provider.js', () => {
  const state: any = { git: null };
  return {
    getGitProvider: () => state.git,
    __setGit: (g: any) => { state.git = g; }
  };
});

const { __setGit } = await import('../../src/api/git-provider.js' as any);

describe('getDefaultBranch cache', () => {
  it('uses cached value on subsequent calls for same repoKey', async () => {
    // Use a unique repoId so no prior test polluted the cache key
    const evt: any = { repoId: 'owner/repo-cache-unique' };

    // First provider returns symbolic HEAD -> feature
    __setGit({
      resolveRef: vi.fn(async () => 'refs/heads/feature'),
      listRefs: vi.fn(async () => [])
    });

    const first = await getDefaultBranch(evt);
    expect(first).toBe('feature');

    // Change provider behavior to prefer main, but cache should retain 'feature'
    __setGit({
      resolveRef: vi.fn(async () => 'deadbeef'),
      listRefs: vi.fn(async () => [{ ref: 'refs/heads/main' }])
    });

    const second = await getDefaultBranch(evt);
    expect(second).toBe('feature');
  });
});
