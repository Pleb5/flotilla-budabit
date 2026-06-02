import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import { mapDiffHashToFile, githubPermalinkDiffId, rootDir } from '../../src/git/git.js';

vi.mock('../../src/api/git-provider.js', () => {
  const state: any = { git: null };
  return {
    getGitProvider: () => state.git,
    __setGit: (g: any) => { state.git = g; }
  };
});

const { __setGit } = await import('../../src/api/git-provider.js' as any);

describe('mapDiffHashToFile (strict)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const dir = `${rootDir}/o/r`;

  it('returns null when there are no changes', async () => {
    const walk = vi.fn(async () => []);
    const TREE = vi.fn((x: any) => x);
    __setGit({ walk, TREE });

    const result = await mapDiffHashToFile(dir, 'old', 'new', 'deadbeef');
    expect(result).toBeNull();
  });

  it('returns the single change directly when only one change exists', async () => {
    const walk = vi.fn(async () => ([{ filepath: 'only.txt', type: 'modify' }]));
    const TREE = vi.fn((x: any) => x);
    __setGit({ walk, TREE });

    const hash = await githubPermalinkDiffId('only.txt');
    const result = await mapDiffHashToFile(dir, 'old', 'new', hash);
    expect(result).toEqual({ filepath: 'only.txt', type: 'modify' });
  });

  it('selects the matching file when multiple changes are present', async () => {
    const walk = vi.fn(async () => ([
      { filepath: 'a.txt', type: 'add' },
      { filepath: 'b.txt', type: 'modify' },
      { filepath: 'target.md', type: 'remove' },
    ]));
    const TREE = vi.fn((x: any) => x);
    __setGit({ walk, TREE });

    const hash = await githubPermalinkDiffId('target.md');
    const result = await mapDiffHashToFile(dir, 'old', 'new', hash);
    expect(result).toEqual({ filepath: 'target.md', type: 'remove' });
  });
});
