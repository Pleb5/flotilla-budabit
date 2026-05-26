import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import { ensureRepoFromEvent, rootDir, clearRepoDepthCache } from '../../src/git/git.js';

vi.mock('../../src/api/git-provider.js', () => {
  const state: any = { git: null };
  return {
    getGitProvider: () => state.git,
    __setGit: (g: any) => { state.git = g; }
  };
});

const { __setGit } = await import('../../src/api/git-provider.js' as any);

describe('ensureRepoFromEvent deepening path (strict)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearRepoDepthCache(); // Clear the depth cache between tests
  });

  function makeRepoEvent(host = 'example.com') {
    return {
      repoId: 'owner/repo',
      clone: [`https://${host}/owner/repo.git`],
    } as any;
  }

  it('when repo exists and depth>1, resolves branch robustly and fetches with depth', async () => {
    const dir = `${rootDir}/owner/repo`;
    const resolveRef = vi.fn(async (arg: any) => {
      if (arg.ref === 'HEAD') return 'ref: refs/heads/main';
      return '0123456789abcdef0123456789abcdef01234567';
    });
    const listRefs = vi.fn(async () => [{ ref: 'refs/heads/main' }]);
    const fetch = vi.fn(async () => undefined);
    const clone = vi.fn(async () => undefined);
    const deleteRef = vi.fn(async () => undefined);

    // Mark repo as cloned (isRepoCloned checks resolveRef HEAD)
    __setGit({ resolveRef, listRefs, fetch, clone, deleteRef });

    await ensureRepoFromEvent({ repoEvent: makeRepoEvent(), branch: 'main' }, 5);

    expect(fetch).toHaveBeenCalledTimes(1);
    const args = (fetch as any).mock.calls[0][0];
    expect(args.dir).toBe(dir);
    expect(args.url).toBe('https://example.com/owner/repo.git');
    expect(args.depth).toBe(5);
    expect(args.singleBranch).toBe(true);
    expect(typeof args.ref).toBe('string');
    expect((args.ref as string).length).toBeGreaterThan(7);
  });

  it('when deepening fetch fails, tries later clone URLs', async () => {
    const badUrl = 'https://bad.example.com/owner/repo.git';
    const goodUrl = 'https://example.com/owner/repo.git';
    const resolveRef = vi.fn(async (arg: any) => {
      if (arg.ref === 'HEAD') return 'ref: refs/heads/main';
      return '0123456789abcdef0123456789abcdef01234567';
    });
    const listRefs = vi.fn(async () => [{ ref: 'refs/heads/main' }]);
    const fetch = vi.fn(async (args: any) => {
      if (args.url === badUrl) throw new Error('bad remote');
    });

    __setGit({ resolveRef, listRefs, fetch });

    await ensureRepoFromEvent(
      { repoEvent: { ...makeRepoEvent(), clone: [badUrl, goodUrl] }, branch: 'main' },
      5
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(call => call[0].url)).toEqual([badUrl, goodUrl]);
    expect(fetch.mock.calls[1][0].depth).toBe(5);
  });

  it('deepening fetch failure is wrapped and swallowed (function resolves)', async () => {
    const resolveRef = vi.fn(async (arg: any) => {
      if (arg.ref === 'HEAD') return 'ref: refs/heads/main';
      return '0123456789abcdef0123456789abcdef01234567';
    });
    const listRefs = vi.fn(async () => [{ ref: 'refs/heads/main' }]);
    const fetch = vi.fn(async () => { throw new Error('network'); });

    __setGit({ resolveRef, listRefs, fetch });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(ensureRepoFromEvent({ repoEvent: makeRepoEvent(), branch: 'main' }, 3)).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
