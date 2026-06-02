import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { resolveBranchName } from '../../src/worker/workers/branches.js';

function makeGit(mocks: any) {
  return {
    resolveRef: async ({ ref }: any) => {
      if (mocks.resolveRefError?.has(ref)) throw new Error('not found');
      return mocks.refs?.[ref] || 'oid';
    },
    listBranches: async () => mocks.branchList ?? [],
  } as any;
}

describe('worker/branches resolveBranchName', () => {
  it('returns requestedBranch if it resolves', async () => {
    const git = makeGit({});
    const res = await resolveBranchName(git, '/repo', 'feature');
    expect(res).toBe('feature');
  });

  it('returns requestedBranch when no fallbacks exist (caller will sync)', async () => {
    // When requested branch doesn't exist AND no fallbacks exist, return requested for fetch
    const git = makeGit({ 
      resolveRefError: new Set(['feat', 'main', 'master', 'develop', 'dev']),
      branchList: [] // No branches available
    });
    const res = await resolveBranchName(git, '/repo', 'feat');
    expect(res).toBe('feat');
  });

  it('falls back to main when requested branch does not exist', async () => {
    // When requested branch doesn't exist but main does, use main (non-strict mode)
    const git = makeGit({ resolveRefError: new Set(['feat', 'refs/heads/feat', 'origin/feat', 'refs/remotes/origin/feat']) });
    const res = await resolveBranchName(git, '/repo', 'feat');
    expect(res).toBe('main');
  });

  it('falls back to known names when none requested', async () => {
    const git = makeGit({
      resolveRefError: new Set([
        'main', 'refs/heads/main', 'origin/main', 'refs/remotes/origin/main',
        'master', 'refs/heads/master', 'origin/master', 'refs/remotes/origin/master',
        'develop', 'refs/heads/develop', 'origin/develop', 'refs/remotes/origin/develop'
      ]),
      refs: { dev: 'abc' },
    });
    const res = await resolveBranchName(git, '/repo');
    expect(res).toBe('dev');
  });

  it('uses first available from listBranches when specific fallbacks fail', async () => {
    const git = makeGit({
      resolveRefError: new Set([
        'main', 'refs/heads/main', 'origin/main', 'refs/remotes/origin/main',
        'master', 'refs/heads/master', 'origin/master', 'refs/remotes/origin/master',
        'develop', 'refs/heads/develop', 'origin/develop', 'refs/remotes/origin/develop',
        'dev', 'refs/heads/dev', 'origin/dev', 'refs/remotes/origin/dev'
      ]),
      branchList: ['trunk', 'release'],
    });
    const res = await resolveBranchName(git, '/repo');
    expect(res).toBe('trunk');
  });

  it('throws when listBranches fails', async () => {
    const git: any = {
      resolveRef: async () => { throw new Error('nope'); },
      listBranches: async () => { throw new Error('boom'); },
    };
    await expect(resolveBranchName(git, '/repo')).rejects.toBeInstanceOf(Error);
  });
});
