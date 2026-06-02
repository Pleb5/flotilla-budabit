import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';

import type { GitProvider } from '../../src/git/provider.js';
import type { RepoCacheManager, RepoCache } from '../../src/worker/workers/cache.js';
import { needsUpdateUtil, syncWithRemoteUtil } from '../../src/worker/workers/sync.js';

import { VirtualGitRemote } from '../git/virtual-remote.js';
import { createRemoteRegistry } from '../utils/remote-registry.js';
import { createTestGitProvider } from '../utils/provider-harness.js';
import { createTestFs, mkdirp } from '../utils/lightningfs.js';

class MemCacheManager implements Partial<RepoCacheManager> {
  private map = new Map<string, any>();

  async getRepoCache(key: string): Promise<any> {
    return this.map.get(key) ?? null;
  }

  async setRepoCache(cache: any): Promise<void> {
    this.map.set(cache.repoId, cache);
  }
}

async function unlinkIfExists(fs: any, path: string): Promise<void> {
  try {
    await fs.promises.unlink(path);
  } catch {
    // ignore
  }
}

describe('worker/sync: needsUpdateUtil + syncWithRemoteUtil (real provider)', () => {
  it('needsUpdateUtil: no cache probes remote heads via listServerRefs', async () => {
    const remoteFs = createTestFs('sync-remote-probe');
    const remote = new VirtualGitRemote({
      fs: remoteFs as any,
      dir: '/remote',
      defaultBranch: 'main',
      author: { name: 'Remote', email: 'remote@example.com' }
    });

    await remote.seed({ 'README.md': 'hello\n' });

    const registry = createRemoteRegistry();
    const url = 'https://example.com/owner/repo.git';
    registry.register(url, remote);

    const localFs = createTestFs('sync-local-probe');
    const git = createTestGitProvider({ fs: localFs as any, remoteRegistry: registry });

    const needs = await needsUpdateUtil(git as any, 'owner/repo', [url], null, Date.now());
    expect(needs).toBe(true);
  });

  it('needsUpdateUtil: stale cache returns true', async () => {
    const localFs = createTestFs('sync-stale-cache');
    const registry = createRemoteRegistry();
    const git = createTestGitProvider({ fs: localFs as any, remoteRegistry: registry });

    const cache: RepoCache = {
      repoId: 'owner/repo',
      lastUpdated: Date.now() - 2 * 60 * 60 * 1000,
      headCommit: 'old',
      dataLevel: 'shallow',
      branches: [],
      cloneUrls: ['https://example.com/owner/repo.git']
    };

    const needs = await needsUpdateUtil(
      git as any,
      'owner/repo',
      ['https://example.com/owner/repo.git'],
      cache,
      Date.now()
    );
    expect(needs).toBe(true);
  });

  it('syncWithRemoteUtil fetches and creates local branch from origin tracking ref if missing', async () => {
    const remoteFs = createTestFs('sync-remote-branch-create');
    const remote = new VirtualGitRemote({
      fs: remoteFs as any,
      dir: '/remote',
      defaultBranch: 'main',
      author: { name: 'Remote', email: 'remote@example.com' }
    });

    await remote.seed({ 'README.md': 'hello\n' });

    const registry = createRemoteRegistry();
    const url = 'https://example.com/owner/repo.git';
    registry.register(url, remote);

    const localFs = createTestFs('sync-local-branch-create');
    const git = createTestGitProvider({ fs: localFs as any, remoteRegistry: registry });
    const cacheManager = new MemCacheManager();

    const rootDir = '/repos';
    const repoId = 'owner/repo';
    const dir = `${rootDir}/${repoId}`;
    await mkdirp(localFs as any, dir);

    // Clone from the virtual remote first
    await (git as any).clone({ dir, url, ref: 'main' });

    // Simulate missing local refs/heads/main while keeping tracking ref
    await unlinkIfExists(localFs as any, `${dir}/.git/refs/heads/main`);

    // Verify listBranches now likely does not include main
    const beforeBranches = await (git as any).listBranches({ dir });
    expect(Array.isArray(beforeBranches)).toBe(true);

    const result = await syncWithRemoteUtil(
      git as any as GitProvider,
      cacheManager as any as RepoCacheManager,
      { repoId, cloneUrls: [url], branch: 'main' },
      {
        rootDir,
        parseRepoId: (id) => id,
        resolveBranchName: async (_d, requested) => requested || 'main',
        isRepoCloned: async (d) => {
          try {
            const st = await (localFs as any).promises.stat(`${d}/.git`);
            return typeof st.isDirectory === 'function' ? st.isDirectory() : st.type === 'dir';
          } catch {
            return false;
          }
        },
        toPlain: (v) => v
      }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result as any).branch).toBe('main');
      expect((result as any).serializable).toBe(true);
    }

    const afterBranches = await (git as any).listBranches({ dir });
    expect(afterBranches.includes('main')).toBe(true);
  });

  it('syncWithRemoteUtil gracefully returns success with warning on CORS/network fetch errors', async () => {
    const remoteFs = createTestFs('sync-remote-cors');
    const remote = new VirtualGitRemote({
      fs: remoteFs as any,
      dir: '/remote',
      defaultBranch: 'main',
      author: { name: 'Remote', email: 'remote@example.com' }
    });

    await remote.seed({ 'README.md': 'hello\n' });

    const registry = createRemoteRegistry();
    const url = 'https://example.com/owner/repo.git';
    registry.register(url, remote);

    const localFs = createTestFs('sync-local-cors');
    const git = createTestGitProvider({ fs: localFs as any, remoteRegistry: registry });
    const cacheManager = new MemCacheManager();

    const rootDir = '/repos';
    const repoId = 'owner/repo';
    const dir = `${rootDir}/${repoId}`;
    await mkdirp(localFs as any, dir);
    await (git as any).clone({ dir, url, ref: 'main' });

    // Override fetch to simulate a CORS/network-like failure
    const origFetch = (git as any).fetch;
    (git as any).fetch = vi.fn().mockRejectedValue(new Error('CORS: Access-Control blocked'));

    const result = await syncWithRemoteUtil(
      git as any as GitProvider,
      cacheManager as any as RepoCacheManager,
      { repoId, cloneUrls: [url], branch: 'main' },
      {
        rootDir,
        parseRepoId: (id) => id,
        resolveBranchName: async (_d, requested) => requested || 'main',
        isRepoCloned: async (d) => {
          try {
            const st = await (localFs as any).promises.stat(`${d}/.git`);
            return typeof st.isDirectory === 'function' ? st.isDirectory() : st.type === 'dir';
          } catch {
            return false;
          }
        },
        toPlain: (v) => v
      }
    );

    // restore
    (git as any).fetch = origFetch;

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result as any).synced).toBe(false);
      expect(String((result as any).warning || '')).toContain('CORS');
    }
  });
});