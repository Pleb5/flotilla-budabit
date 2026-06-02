import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';

import { IsomorphicGitProvider } from '../../src/git/isomorphic-git-provider.js';

vi.mock('isomorphic-git', async () => {
  return {
    default: {},
    clone: vi.fn(async (opts: any) => ({ ok: true, opts })),
    fetch: vi.fn(async (opts: any) => ({ ok: true, opts })),
    pull: vi.fn(async (opts: any) => ({ ok: true, opts })),
    push: vi.fn(async (opts: any) => ({ ok: true, opts })),
    getRemoteInfo: vi.fn(async (opts: any) => ({ ok: true, opts })),
    listServerRefs: vi.fn(async (opts: any) => ({ ok: true, opts })),
    TREE: vi.fn((opts: any) => ({ walker: true, opts })),
  } as any;
});

const isogit = await import('isomorphic-git');

describe('IsomorphicGitProvider delegation', () => {
  it('clone/fetch/pull/push pass fs/http and corsProxy (default or overridden)', async () => {
    const prov = new IsomorphicGitProvider({ fs: { fs: true }, http: { http: true }, corsProxy: 'https://proxy' });

    await prov.clone({ dir: '/r', url: 'u' });
    await prov.fetch({ dir: '/r', ref: 'main' });
    await prov.pull({ dir: '/r', ref: 'main' });
    await prov.push({ dir: '/r', ref: 'main', corsProxy: null });

    expect((isogit as any).clone).toHaveBeenCalled();
    expect((isogit as any).fetch).toHaveBeenCalled();
    expect((isogit as any).pull).toHaveBeenCalled();
    expect((isogit as any).push).toHaveBeenCalled();

    const pushOpts = (isogit as any).push.mock.calls[0][0];
    expect(pushOpts.corsProxy).toBe(null);
  });

  it('TREE returns isomorphic-git walker with fs bound', () => {
    const prov = new IsomorphicGitProvider({ fs: { fs: true }, http: { http: true }, corsProxy: 'x' });
    const w = prov.TREE({ ref: 'HEAD' });
    expect(w).toEqual({ walker: true, opts: expect.objectContaining({ ref: 'HEAD', fs: { fs: true } }) });
  });

  it('getRemoteInfo/listServerRefs pass http and fs and inherit corsProxy when not overridden', async () => {
    const prov = new IsomorphicGitProvider({ fs: { fs: true }, http: { http: true }, corsProxy: 'proxyZ' });

    await prov.getRemoteInfo({ url: 'https://g.com' });
    await prov.listServerRefs({ url: 'https://g.com' });

    const gri = (isogit as any).getRemoteInfo.mock.calls[0][0];
    expect(gri.http).toEqual({ http: true });
    expect(gri.corsProxy).toBe('proxyZ');

    const lsr = (isogit as any).listServerRefs.mock.calls[0][0];
    expect(lsr.http).toEqual({ http: true });
    expect(lsr.corsProxy).toBe('proxyZ');
  });
});
