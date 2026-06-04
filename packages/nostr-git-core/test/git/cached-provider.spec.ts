import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';

import { CachedGitProvider } from '../../src/git/cached-provider.js';

function makeInner() {
  const calls: Record<string, number> = {};
  const bump = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const inner = {
    fs: { kind: 'fs' },
    listRefs: vi.fn(async (opts: any) => { bump('listRefs'); return [{ ref: 'refs/heads/main' }]; }),
    listBranches: vi.fn(async (opts: any) => { bump('listBranches'); return ['main']; }),
    commit: vi.fn(async (opts: any) => { bump('commit'); }),
    writeRef: vi.fn(async (opts: any) => { bump('writeRef'); }),
  } as any;
  return { inner, calls };
}

describe('CachedGitProvider', () => {
  it('exposes baseProvider fs and injects stable cache object by dir', async () => {
    const { inner, calls } = makeInner();
    const prov = new CachedGitProvider(inner, { compatMode: false, cacheMode: 'per-session', cacheMaxAgeMs: 60000 });

    expect((prov as any).baseProvider).toBe(inner);
    expect((prov as any).fs).toEqual({ kind: 'fs' });

    const dir = '/repo';
    const firstOpts = { dir };
    const secondOpts = { dir };
    await prov.listRefs(firstOpts);
    await prov.listRefs(secondOpts);
    // Inner was invoked twice, but should have received the same cache object identity
    const call1 = (inner.listRefs as any).mock.calls[0][0];
    const call2 = (inner.listRefs as any).mock.calls[1][0];
    expect(call1.cache).toBe(call2.cache);

    await prov.listBranches({ dir });
    await prov.listBranches({ dir });
    const b1 = (inner.listBranches as any).mock.calls[0][0];
    const b2 = (inner.listBranches as any).mock.calls[1][0];
    expect(b1.cache).toBe(b2.cache);
  });

  it('invalidates cache on mutations (commit/writeRef)', async () => {
    const { inner, calls } = makeInner();
    const prov = new CachedGitProvider(inner, { compatMode: false, cacheMode: 'per-session', cacheMaxAgeMs: 60000 });
    const dir = '/repo2';

    await prov.listRefs({ dir });
    await prov.listRefs({ dir });
    const before = (inner.listRefs as any).mock.calls[1][0].cache;

    await prov.commit({ dir });

    await prov.listRefs({ dir });
    const afterCommit = (inner.listRefs as any).mock.calls.at(-1)[0].cache;
    expect(afterCommit).not.toBe(before);

    await prov.writeRef({ dir });
    await prov.listRefs({ dir });
    const afterWriteRef = (inner.listRefs as any).mock.calls.at(-1)[0].cache;
    expect(afterWriteRef).not.toBe(afterCommit);
  });
});
