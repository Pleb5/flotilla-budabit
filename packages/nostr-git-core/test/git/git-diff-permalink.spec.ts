import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import { produceGitDiffFromPermalink } from '../../src/git/git.js';

vi.mock('../../src/api/git-provider.js', () => {
  const state: any = { git: null };
  return {
    getGitProvider: () => state.git,
    __setGit: (g: any) => { state.git = g; }
  };
});

const { __setGit } = await import('../../src/api/git-provider.js' as any);

describe('git/produceGitDiffFromPermalink (strict)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns error string when repo cannot be ensured (pre-SHA validation)', async () => {
    // With no provider set, ensureRepo will fail internally and the function returns an Error string
    const data: any = { owner: 'o', repo: 'r', host: 'h', filePath: 'f', platform: 'github', branch: '' };
    const result = await produceGitDiffFromPermalink(data);
    expect(String(result)).toMatch(/^Error:/);
  });

  it('parent-less commit -> generates multi-file patch (Index format)', async () => {
    // Mock provider used by functions
    const walk = vi.fn(async () => ([{ filepath: 'a.txt', type: 'add' }]));
    const readCommit = vi.fn(async () => ({ commit: { parent: [] } }));
    const readBlob = vi.fn()
      // oldOid read returns empty
      .mockResolvedValueOnce({ blob: new Uint8Array() })
      // newOid read returns some content
      .mockResolvedValueOnce({ blob: new TextEncoder().encode('hello') });
    const resolveRef = vi.fn(async () => 'newCommit');
    const TREE = vi.fn((x: any) => x);
    const clone = vi.fn(async () => undefined);
    const fetch = vi.fn(async () => undefined);
    const deleteRef = vi.fn(async () => undefined);
    __setGit({ walk, readCommit, readBlob, resolveRef, clone, fetch, deleteRef, TREE });

    const data: any = { owner: 'o', repo: 'r', host: 'h', platform: 'github', branch: 'newCommit', filePath: 'a.txt' };
    const patch = await produceGitDiffFromPermalink(data);
    expect(typeof patch).toBe('string');
    expect(patch).toContain('Index: a.txt');
  });

  it('selects matching file via diffFileHash when multiple files changed (Index format)', async () => {
    const readCommit = vi.fn(async () => ({ commit: { parent: ['parent1'] } }));
    const walk = vi.fn(async () => ([
      { filepath: 'a.txt', type: 'modify' },
      { filepath: 'b.txt', type: 'add' },
    ]));
    const readBlob = vi.fn()
      // a.txt parent
      .mockResolvedValueOnce({ blob: new TextEncoder().encode('A1') })
      // a.txt new
      .mockResolvedValueOnce({ blob: new TextEncoder().encode('A2') })
      // b.txt parent (empty)
      .mockResolvedValueOnce({ blob: new Uint8Array() })
      // b.txt new
      .mockResolvedValueOnce({ blob: new TextEncoder().encode('B') });
    const resolveRef = vi.fn(async () => 'newCommit');
    const TREE = vi.fn((x: any) => x);
    const clone = vi.fn(async () => undefined);
    const fetch = vi.fn(async () => undefined);
    const deleteRef = vi.fn(async () => undefined);
    __setGit({ walk, readCommit, readBlob, resolveRef, clone, fetch, deleteRef, TREE });

    const mod = await import('../../src/git/git.js');
    const diffFileHash = await mod.githubPermalinkDiffId('b.txt');

    const data: any = {
      owner: 'o', repo: 'r', host: 'h', platform: 'github',
      branch: 'newCommit', diffFileHash
    };
    const patch = await mod.produceGitDiffFromPermalink(data);
    expect(patch).toContain('Index: b.txt');
    expect(patch).not.toContain('Index: a.txt');
  });
});
