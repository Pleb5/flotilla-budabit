import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { RepoCacheManager, type RepoCache } from '../../src/worker/workers/cache.js';

const makeCache = (over: Partial<RepoCache> = {}): RepoCache => ({
  repoId: 'owner/repo',
  lastUpdated: Date.now(),
  headCommit: 'deadbeef',
  dataLevel: 'refs',
  branches: [{ name: 'main', commit: 'deadbeef' }],
  cloneUrls: ['https://example.com/repo.git'],
  ...over,
});

describe('worker/cache RepoCacheManager', () => {
  it('init + set/get repo cache', async () => {
    const mgr = new RepoCacheManager();
    await mgr.init();
    const cache = makeCache({ repoId: 'r1' });
    await mgr.setRepoCache(cache);
    const got = await mgr.getRepoCache('r1');
    expect(got?.repoId).toBe('r1');
    expect(got?.headCommit).toBe('deadbeef');
  });

  it('set/get/delete merge analysis entries', async () => {
    const mgr = new RepoCacheManager();
    await mgr.init();
    const result: any = { analysis: 'clean', conflictFiles: [] };
    await mgr.setMergeAnalysis('repoA', 'patch1', 'main', result);
    const got = await mgr.getMergeAnalysis('repoA', 'patch1', 'main');
    expect(got?.analysis).toBe('clean');
    await mgr.deleteMergeAnalysis('repoA', 'patch1', 'main');
    const gone = await mgr.getMergeAnalysis('repoA', 'patch1', 'main');
    expect(gone).toBeNull();
  });

  it('set/get commit history and delete', async () => {
    const mgr = new RepoCacheManager();
    await mgr.init();
    await mgr.setCommitHistory({
      id: 'repoA:main',
      repoId: 'repoA',
      branch: 'main',
      commits: [{ oid: '1' }, { oid: '2' }],
      lastUpdated: Date.now(),
      depth: 2,
    });
    const hist = await mgr.getCommitHistory('repoA', 'main');
    expect(hist?.commits.length).toBe(2);
    await mgr.deleteCommitHistory('repoA', 'main');
    const after = await mgr.getCommitHistory('repoA', 'main');
    expect(after).toBeNull();
  });

  it('clearOldCache removes old repo and commit entries', async () => {
    const mgr = new RepoCacheManager();
    await mgr.init();
    // Insert old repo cache
    await mgr.setRepoCache(makeCache({ repoId: 'old', lastUpdated: Date.now() - 10 * 24 * 60 * 60 * 1000 }));
    // Insert old commit history
    await mgr.setCommitHistory({
      id: 'old:main',
      repoId: 'old',
      branch: 'main',
      commits: [],
      lastUpdated: Date.now() - 10 * 24 * 60 * 60 * 1000,
      depth: 0,
    });
    await mgr.clearOldCache(7 * 24 * 60 * 60 * 1000);

    const repoGone = await mgr.getRepoCache('old');
    const commitGone = await mgr.getCommitHistory('old', 'main');
    expect(repoGone).toBeNull();
    expect(commitGone).toBeNull();
  });
});
