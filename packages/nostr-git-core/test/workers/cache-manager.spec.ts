import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import { RepoCacheManager, type RepoCache } from '../../src/worker/workers/cache.js';

describe('RepoCacheManager (IndexedDB)', () => {
  let mgr: RepoCacheManager;

  beforeEach(async () => {
    // Reset database by creating a new instance each time
    mgr = new RepoCacheManager();
    await mgr.init();
  });

  it('setRepoCache/getRepoCache round-trip', async () => {
    const cache: RepoCache = {
      repoId: 'owner:repo',
      lastUpdated: Date.now(),
      headCommit: '0123456789abcdef0123456789abcdef01234567',
      dataLevel: 'refs',
      branches: [
        { name: 'main', commit: '0123456789abcdef0123456789abcdef01234567' },
        { name: 'feature', commit: '89abcdef0123456789abcdef0123456789abcdef' },
      ],
      cloneUrls: ['https://example.com/owner/repo.git'],
      tags: [
        { name: 'v1.0.0', commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      ],
    };

    await mgr.setRepoCache(cache);
    const read = await mgr.getRepoCache('owner:repo');
    expect(read?.repoId).toBe(cache.repoId);
    expect(read?.headCommit).toBe(cache.headCommit);
    expect(read?.branches?.length).toBe(2);
    expect(read?.tags?.[0]?.name).toBe('v1.0.0');
  });

  it('mergeAnalysis: set/get/delete', async () => {
    const repoId = 'owner:repo';
    const patchId = 'patch-123';
    const targetBranch = 'main';

    // get before set should be null
    const before = await mgr.getMergeAnalysis(repoId, patchId, targetBranch);
    expect(before).toBeNull();

    const result = { status: 'clean', mergeBase: 'deadbeef', conflicts: [] } as any;
    await mgr.setMergeAnalysis(repoId, patchId, targetBranch, result);

    const after = await mgr.getMergeAnalysis(repoId, patchId, targetBranch);
    expect(after).toEqual(result);

    await mgr.deleteMergeAnalysis(repoId, patchId, targetBranch);
    const deleted = await mgr.getMergeAnalysis(repoId, patchId, targetBranch);
    expect(deleted).toBeNull();
  });

  it('getRepoCache propagates request error (onerror)', async () => {
    const mgr = new RepoCacheManager();
    // Inject a fake DB that triggers onerror for get()
    const fakeError = new Error('get failed');
    const req: any = { onerror: null as any, onsuccess: null as any, error: fakeError };
    const fakeDb: any = {
      transaction: () => ({
        objectStore: () => ({
          get: () => {
            setTimeout(() => req.onerror && req.onerror(new Event('error')));
            return req;
          },
        }),
      }),
    };
    (mgr as any).db = fakeDb;
    await expect(mgr.getRepoCache('owner:repo')).rejects.toThrow(/get failed/);
  });

  it('setRepoCache propagates request error (onerror)', async () => {
    const mgr = new RepoCacheManager();
    const fakeError = new Error('put failed');
    const req: any = { onerror: null as any, onsuccess: null as any, error: fakeError };
    const fakeDb: any = {
      transaction: () => ({
        objectStore: () => ({
          put: () => {
            setTimeout(() => req.onerror && req.onerror(new Event('error')));
            return req;
          },
        }),
      }),
    };
    (mgr as any).db = fakeDb;
    await expect(mgr.setRepoCache({ repoId: 'x' } as any)).rejects.toThrow(/put failed/);
  });

  it('mergeAnalysis get/set/delete propagate request errors', async () => {
    const mgr = new RepoCacheManager();
    // get error
    let req: any = { onerror: null as any, onsuccess: null as any, error: new Error('ma get failed') };
    (mgr as any).db = {
      transaction: () => ({ objectStore: () => ({ get: () => { setTimeout(() => req.onerror && req.onerror(new Event('error'))); return req; } }) })
    } as any;
    await expect(mgr.getMergeAnalysis('r','p','b')).rejects.toThrow(/ma get failed/);

    // set error
    req = { onerror: null as any, onsuccess: null as any, error: new Error('ma put failed') };
    (mgr as any).db = {
      transaction: () => ({ objectStore: () => ({ put: () => { setTimeout(() => req.onerror && req.onerror(new Event('error'))); return req; } }) })
    } as any;
    await expect(mgr.setMergeAnalysis('r','p','b', { ok: true } as any)).rejects.toThrow(/ma put failed/);

    // delete error
    req = { onerror: null as any, onsuccess: null as any, error: new Error('ma delete failed') };
    (mgr as any).db = {
      transaction: () => ({ objectStore: () => ({ delete: () => { setTimeout(() => req.onerror && req.onerror(new Event('error'))); return req; } }) })
    } as any;
    await expect(mgr.deleteMergeAnalysis('r','p','b')).rejects.toThrow(/ma delete failed/);
  });
});
