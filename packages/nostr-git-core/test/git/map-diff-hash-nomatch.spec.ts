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

describe('mapDiffHashToFile – no match', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when diffFileHash does not match any changed file', async () => {
    const dir = `${rootDir}/o/r`;
    const walk = vi.fn(async () => ([
      { filepath: 'a.txt', type: 'add' },
      { filepath: 'b.txt', type: 'modify' },
    ]));
    const TREE = vi.fn((x: any) => x);
    __setGit({ walk, TREE });

    const nonMatch = await githubPermalinkDiffId('c.txt');
    const result = await mapDiffHashToFile(dir, 'old', 'new', nonMatch);
    expect(result).toBeNull();
  });
});
