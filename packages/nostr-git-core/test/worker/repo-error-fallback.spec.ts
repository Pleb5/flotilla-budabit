import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initializeRepoUtil,
  ensureShallowCloneUtil,
  ensureFullCloneUtil,
  cloneRemoteRepoUtil
} from '../../src/worker/workers/repos.js';
import type { GitProvider } from '../../src/git/provider.js';

function makeCacheManager() {
  return {
    getRepoCache: vi.fn().mockResolvedValue(null),
    setRepoCache: vi.fn().mockResolvedValue(void 0),
    init: vi.fn().mockResolvedValue(void 0)
  } as any;
}

function noop() {}

describe('worker repo error/fallback paths', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initializeRepoUtil throws last non-CORS error when all refs and URLs fail', async () => {
    const lastError = new Error('final failure');
    const git = {
      clone: vi.fn().mockRejectedValue(lastError)
    } as any;
    const cache = makeCacheManager();
    const deps = {
      rootDir: '/tmp',
      parseRepoId: (id: string) => id,
      repoDataLevels: new Map(),
      clonedRepos: new Set<string>(),
    };
    const result = await initializeRepoUtil(git, cache, { repoId: 'r7', cloneUrls: ['https://1', 'https://2'] }, deps as any, noop);
    expect(result.success).toBe(false);
    // New error message format includes count of URLs tried
    expect(result.error).toContain('final failure');
  });

  it('ensureFullCloneUtil happy path caps depth at 100 and emits progress', async () => {
    const progress: string[] = [];
    const git = {
      listRemotes: vi.fn().mockResolvedValue([{ remote: 'origin', url: 'https://example/repo.git' }]),
      fetch: vi.fn().mockImplementation(async (opts: any) => {
        expect(opts.depth).toBe(100);
        // simulate progress callback usage
        opts.onProgress && opts.onProgress({ phase: 'Receiving objects', loaded: 10, total: 100 });
      }),
      resolveRef: vi.fn().mockResolvedValue('abc')
    } as any;
    const deps = {
      rootDir: '/tmp',
      parseRepoId: (id: string) => id,
      repoDataLevels: new Map(),
      clonedRepos: new Set<string>(['r8']),
      isRepoCloned: async () => true,
      resolveBranchName: async () => 'main',
    };
    const res = await ensureFullCloneUtil(git, { repoId: 'r8', depth: 150 }, deps as any, (p: string) => progress.push(p));
    expect(res.success).toBe(true);
    expect(res.level).toBe('full');
    expect(progress.find((s) => s.includes('Full clone:'))).toBeTruthy();
  });

  it('initializeRepoUtil returns CORS specialized error result when clone fails due to CORS', async () => {
    const git = {
      clone: vi.fn().mockRejectedValue(Object.assign(new Error('CORS blocked'), { message: 'CORS blocked' }))
    } as any;
    const cache = makeCacheManager();
    const deps = {
      rootDir: '/tmp',
      parseRepoId: (id: string) => id,
      repoDataLevels: new Map(),
      clonedRepos: new Set<string>(),
    };
    const res = await initializeRepoUtil(git, cache, { repoId: 'r1', cloneUrls: ['https://example/repo.git'] }, deps as any, noop);
    expect(res.success).toBe(false);
    expect((res as any).corsError).toBe(true);
    expect(String(res.error)).toMatch(/CORS\/network restrictions/i);
  });

  it('ensureShallowCloneUtil returns not initialized error when repo missing', async () => {
    const git = {
      resolveRef: vi.fn(),
      listRemotes: vi.fn(),
      fetch: vi.fn(),
      checkout: vi.fn(),
    } as any;
    const deps = {
      rootDir: '/tmp',
      parseRepoId: (id: string) => id,
      repoDataLevels: new Map(),
      clonedRepos: new Set<string>(),
      isRepoCloned: async () => false,
      resolveBranchName: async () => 'main',
    };
    const res = await ensureShallowCloneUtil(git, { repoId: 'r2' }, deps as any, noop);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Repository not initialized/);
  });

  it('ensureFullCloneUtil returns error when origin remote missing URL', async () => {
    const git = {
      listRemotes: vi.fn().mockResolvedValue([{ remote: 'other', url: undefined }]),
    } as any;
    const deps = {
      rootDir: '/tmp',
      parseRepoId: (id: string) => id,
      repoDataLevels: new Map(),
      clonedRepos: new Set<string>(['r3']),
      isRepoCloned: async () => true,
      resolveBranchName: async () => 'main',
    };
    const res = await ensureFullCloneUtil(git, { repoId: 'r3' }, deps as any, noop);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Origin remote not found/);
  });

  it('cloneRemoteRepoUtil wraps invalid URL errors with "Clone failed:"', async () => {
    const git = {
      listServerRefs: vi.fn(),
      clone: vi.fn(),
    } as any;
    const cache = makeCacheManager();
    await expect(
      cloneRemoteRepoUtil(git, cache, { url: 'not-a-url', dir: '/tmp/r4' } as any)
    ).rejects.toThrow(/Clone failed: Invalid repository URL: not-a-url/);
  });

  it('smartInitializeRepoUtil returns cache when available and not forceUpdate', async () => {
    const cache = makeCacheManager();
    cache.getRepoCache.mockResolvedValueOnce({ dataLevel: 'refs', branches: [{ name: 'main', commit: 'abc' }], headCommit: 'abc' });
    const git = {} as any;
    const deps = {
      rootDir: '/tmp',
      parseRepoId: (id: string) => id,
      repoDataLevels: new Map(),
      clonedRepos: new Set<string>(),
      isRepoCloned: async () => true,
      resolveBranchName: async () => 'main',
    };
    // import function here to avoid circular
    const { smartInitializeRepoUtil } = await import('../../src/worker/workers/repos.js');
    const res = await smartInitializeRepoUtil(git as any, cache, { repoId: 'r5', cloneUrls: ['https://x'] }, deps as any, noop);
    expect(res.success).toBe(true);
    expect(res.fromCache).toBe(true);
    expect((res as any).dataLevel).toBe('refs');
  });

  it('smartInitializeRepoUtil falls back to initializeRepoUtil on non-network fetch error', async () => {
    const cache = makeCacheManager();
    cache.getRepoCache.mockResolvedValueOnce(null);
    const git: Partial<GitProvider> = {
      fetch: vi.fn().mockRejectedValue(new Error('server 500')),
      clone: vi.fn().mockResolvedValue(void 0),
      listBranches: vi.fn().mockResolvedValue(['main']),
      resolveRef: vi.fn().mockResolvedValue('abc'),
    };
    const deps = {
      rootDir: '/tmp',
      parseRepoId: (id: string) => id,
      repoDataLevels: new Map(),
      clonedRepos: new Set<string>(),
      isRepoCloned: async () => true,
      resolveBranchName: async () => 'main',
    };
    const { smartInitializeRepoUtil } = await import('../../src/worker/workers/repos.js');
    const res = await smartInitializeRepoUtil(git as any, cache, { repoId: 'r6', cloneUrls: ['https://example/repo.git'] }, deps as any, noop);
    expect(res.success).toBe(true);
    expect(res.fromCache).toBe(false);
    expect((res as any).dataLevel).toBe('refs');
  });
});
