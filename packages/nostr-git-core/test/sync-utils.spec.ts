import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitProvider } from '../src/git/provider.js';
import { needsUpdateUtil, syncWithRemoteUtil } from '../src/worker/workers/sync.js';

function makeGit(overrides: Partial<GitProvider> = {}): GitProvider {
  return {
    listServerRefs: vi.fn(async () => []),
    listRemotes: vi.fn(async () => [{ remote: 'origin', url: 'https://example.com/repo.git' }]),
    fetch: vi.fn(async () => {}),
    resolveRef: vi.fn(async () => 'deadbeef'),
    listBranches: vi.fn(async () => ['main']),
    ...overrides
  } as any;
}

const cache = (headCommit = 'abcd', lastUpdated = Date.now()) => ({
  repoId: 'org/repo',
  headCommit,
  lastUpdated,
  dataLevel: 'shallow' as const,
  branches: [],
  cloneUrls: ['https://example.com/repo.git']
});

describe('needsUpdateUtil', () => {
  it('returns false when no cache and remote has no refs (empty)', async () => {
    const git = makeGit({ listServerRefs: vi.fn(async () => []) });
    const res = await needsUpdateUtil(
      git,
      'org/repo',
      ['https://example.com/repo.git'],
      null,
      Date.now()
    );
    expect(res).toBe(false);
  });

  it('returns true when no cache and remote has heads', async () => {
    const git = makeGit({
      listServerRefs: vi.fn(async () => [{ ref: 'refs/heads/main', oid: '1' }])
    });
    const res = await needsUpdateUtil(
      git,
      'org/repo',
      ['https://example.com/repo.git'],
      null,
      Date.now()
    );
    expect(res).toBe(true);
  });

  it('returns true when cache is stale', async () => {
    const git = makeGit();
    const stale = Date.now() - 61 * 60 * 1000;
    const res = await needsUpdateUtil(
      git,
      'org/repo',
      ['https://example.com/repo.git'],
      cache('abcd', stale),
      Date.now()
    );
    expect(res).toBe(true);
  });

  it('compares main/master with cache head', async () => {
    const git = makeGit({
      listServerRefs: vi.fn(async () => [{ ref: 'refs/heads/main', oid: 'ef01' }])
    });
    const res = await needsUpdateUtil(
      git,
      'org/repo',
      ['https://example.com/repo.git'],
      cache('abcd'),
      Date.now()
    );
    expect(res).toBe(true);
  });

  it('returns false when cache is fresh but no cloneUrl provided', async () => {
    // When no URLs are available to check, and cache is fresh, assume no update needed
    const git = makeGit({
      listServerRefs: vi.fn(async () => [{ ref: 'refs/heads/main', oid: 'ef01' }])
    });
    const res = await needsUpdateUtil(
      git,
      'org/repo',
      [],
      cache('abcd'),
      Date.now()
    );
    expect(res).toBe(false);
  });

  it('returns true when cache is stale and no cloneUrl provided', async () => {
    // When no URLs are available but cache is stale (>1 hour), needs update
    const git = makeGit({
      listServerRefs: vi.fn(async () => [{ ref: 'refs/heads/main', oid: 'ef01' }])
    });
    const staleTime = Date.now() - 61 * 60 * 1000; // 61 minutes ago
    const res = await needsUpdateUtil(
      git,
      'org/repo',
      [],
      cache('abcd', staleTime),
      Date.now()
    );
    expect(res).toBe(true);
  });
});

describe('syncWithRemoteUtil', () => {
  const deps = {
    rootDir: '/tmp',
    parseRepoId: (s: string) => s,
    resolveBranchName: async (_dir: string, requested?: string) => requested || 'main',
    isRepoCloned: async (_dir: string) => true,
    toPlain: <T>(v: T) => JSON.parse(JSON.stringify(v)) as T
  };

  it('fetches and updates cache with remote head', async () => {
    const refs = ['cafebabe', 'deadbeef'];
    const git = makeGit({
      resolveRef: vi.fn(async () => refs.shift() ?? 'cafebabe'),
      listBranches: vi.fn(async () => ['main', 'dev'])
    });
    const cacheManager = {
      setRepoCache: vi.fn(async () => {}),
      getRepoCache: vi.fn(async () => null)
    } as any;

    const res = await syncWithRemoteUtil(
      git,
      cacheManager,
      { repoId: 'Org/Repo', cloneUrls: ['https://example.com/repo.git'], branch: 'main' },
      deps
    );
    expect(res.success).toBe(true);
    expect(cacheManager.setRepoCache).toHaveBeenCalled();
  });

  it('returns error if repo not cloned', async () => {
    const git = makeGit();
    const cacheManager = { setRepoCache: vi.fn(async () => {}) } as any;
    const localDeps = { ...deps, isRepoCloned: async () => false };
    const res = await syncWithRemoteUtil(
      git,
      cacheManager,
      { repoId: 'Org/Repo', cloneUrls: ['https://example.com/repo.git'] },
      localDeps
    );
    expect(res.success).toBe(false);
    if ('error' in res) {
      expect(res.error).toMatch(/not cloned/i);
    } else {
      throw new Error(`Expected error property on failed result: ${JSON.stringify(res)}`);
    }
  });
});
