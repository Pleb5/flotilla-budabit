import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { smartInitializeRepoUtil } from '../../src/worker/workers/repos.js';

function makeGitMock() {
  return {
    fetch: vi.fn(),
    resolveRef: vi.fn(),
    writeRef: vi.fn(),
    listBranches: vi.fn(),
    listRemotes: vi.fn(),
    checkout: vi.fn(),
  } as any;
}

function makeCacheManagerMock() {
  return {
    getRepoCache: vi.fn(),
    setRepoCache: vi.fn(),
  } as any;
}

describe('worker: smartInitializeRepoUtil branch/repo flows', () => {
  const rootDir = '/tmp';
  const parseRepoId = (id: string) => id.replace(/[^a-z0-9_-]/gi, '_');
  const repoDataLevels = new Map<string, 'refs' | 'shallow' | 'full'>();
  const clonedRepos = new Set<string>();
  const isRepoCloned = vi.fn().mockResolvedValue(true);
  const sendProgress = vi.fn();

  let git: any;
  let cacheManager: any;

  beforeEach(() => {
    git = makeGitMock();
    cacheManager = makeCacheManagerMock();
    repoDataLevels.clear();
    clonedRepos.clear();
    sendProgress.mockReset();
    isRepoCloned.mockClear();
  });

  it('ensureFullCloneUtil propagates fetch failure as { success: false, error }', async () => {
    const { ensureFullCloneUtil } = await import('../../src/worker/workers/repos.js');
    const resolveBranchName = vi.fn().mockResolvedValue('main');
    git.listRemotes.mockResolvedValue([{ remote: 'origin', url: 'https://example/repo.git' }]);
    git.fetch.mockRejectedValue(new Error('fatal: fetch failed'));
    const repoId = 'team/repo';
    const key = parseRepoId(repoId);
    clonedRepos.add(key);

    const res = await ensureFullCloneUtil(
      git,
      { repoId, branch: 'main', depth: 10 },
      { rootDir, parseRepoId, repoDataLevels, clonedRepos, isRepoCloned, resolveBranchName },
      sendProgress
    );

    expect((res as any).success).toBe(false);
    expect((res as any).error).toMatch(/fatal: fetch failed/);
  });

  it('ensureFullCloneUtil errors when origin remote missing URL', async () => {
    const { ensureFullCloneUtil } = await import('../../src/worker/workers/repos.js');
    const resolveBranchName = vi.fn().mockResolvedValue('main');
    git.listRemotes.mockResolvedValue([{ remote: 'upstream', url: '' }]);
    const repoId = 'team/repo';
    const key = parseRepoId(repoId);
    clonedRepos.add(key);

    const res = await ensureFullCloneUtil(
      git,
      { repoId, branch: 'main', depth: 10 },
      { rootDir, parseRepoId, repoDataLevels, clonedRepos, isRepoCloned, resolveBranchName },
      sendProgress
    );

    expect((res as any).success).toBe(false);
    expect((res as any).error).toMatch(/Origin remote not found/);
  });

  it('ensureFullCloneUtil caps depth at 100 and sets level full', async () => {
    const { ensureFullCloneUtil } = await import('../../src/worker/workers/repos.js');
    const resolveBranchName = vi.fn().mockResolvedValue('main');
    git.listRemotes.mockResolvedValue([{ remote: 'origin', url: 'https://example/repo.git' }]);
    git.fetch.mockResolvedValue(undefined);
    const repoId = 'team/repo';
    const key = parseRepoId(repoId);
    clonedRepos.add(key);

    const res = await ensureFullCloneUtil(
      git,
      { repoId, branch: 'main', depth: 500 },
      { rootDir, parseRepoId, repoDataLevels, clonedRepos, isRepoCloned, resolveBranchName },
      sendProgress
    );

    expect((res as any).success).toBe(true);
    expect((res as any).level).toBe('full');
    expect(repoDataLevels.get(key)).toBe('full');
    const fetchInit = git.fetch.mock.calls[0][0];
    expect(fetchInit.depth).toBe(100);
    expect(fetchInit.ref).toBe('main');
  });

  it('ensureFullCloneUtil returns repo not initialized error when missing clone', async () => {
    const { ensureFullCloneUtil } = await import('../../src/worker/workers/repos.js');
    const resolveBranchName = vi.fn().mockResolvedValue('main');
    isRepoCloned.mockResolvedValue(false);
    const repoId = 'team/new';

    const res = await ensureFullCloneUtil(
      git,
      { repoId, branch: 'main', depth: 10 },
      { rootDir, parseRepoId, repoDataLevels, clonedRepos, isRepoCloned, resolveBranchName },
      sendProgress
    );

    expect((res as any).success).toBe(false);
    expect((res as any).error).toMatch(/Repository not initialized/);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('syncs existing clone, writes branch refs, caches shallow by default', async () => {
    const resolveBranchName = vi.fn().mockResolvedValue('main');
    git.fetch.mockResolvedValue(undefined);
    git.resolveRef.mockResolvedValueOnce('abc123'); // for remote ref
    git.resolveRef.mockResolvedValueOnce('abc123'); // for HEAD fallback if needed
    git.writeRef.mockResolvedValue(undefined);
    git.listBranches.mockResolvedValue(['main']);
    // Safety: if code falls through to initializeRepoUtil, allow clone to succeed
    (git as any).clone = vi.fn().mockResolvedValue(undefined);

    const result = await smartInitializeRepoUtil(
      git,
      cacheManager,
      { repoId: 'team/repo', cloneUrls: ['https://example/repo.git'] },
      { rootDir, parseRepoId, repoDataLevels, clonedRepos, isRepoCloned, resolveBranchName },
      sendProgress
    );

    expect((result as any).success).toBe(true);
    expect((result as any).headCommit).toBe('abc123');
    expect(['shallow', 'refs']).toContain((result as any).dataLevel);
    expect((result as any).branches?.[0]).toMatchObject({ name: 'main', commit: 'abc123' });
    expect(cacheManager.setRepoCache).toHaveBeenCalled();
  });

  it('handles empty repositories by returning refs-only success with warning', async () => {
    const resolveBranchName = vi.fn().mockRejectedValue(new Error('no branches'));
    // fetch is attempted but allowed to be undefined
    git.fetch.mockResolvedValue(undefined);
    isRepoCloned.mockResolvedValueOnce(true);

    const result = await smartInitializeRepoUtil(
      git,
      cacheManager,
      // Use empty cloneUrls to minimize side effects and ensure early branch handling
      { repoId: 'team/empty', cloneUrls: [] },
      { rootDir, parseRepoId, repoDataLevels, clonedRepos, isRepoCloned, resolveBranchName },
      sendProgress
    );

    expect((result as any).success).toBe(true);
    expect((result as any).dataLevel).toBe('refs');
    expect((result as any).warning).toMatch(/no branches/i);
    expect((result as any).serializable).toBe(true);
  });

  it('propagates non-network fetch errors as failure result', async () => {
    const resolveBranchName = vi.fn();
    git.fetch.mockRejectedValue(new Error('fatal: remote error'));
    // initializeRepoUtil will be attempted; ensure git.clone exists and throws same fatal error
    (git as any).clone = vi.fn().mockRejectedValue(new Error('fatal: remote error'));

    const result = await smartInitializeRepoUtil(
      git,
      cacheManager,
      { repoId: 'team/fail', cloneUrls: ['https://example/fail.git'] },
      { rootDir, parseRepoId, repoDataLevels, clonedRepos, isRepoCloned, resolveBranchName },
      sendProgress
    );

    expect((result as any).success).toBe(false);
    expect((result as any).error).toMatch(/fatal/);
  });

  it('ensureShallowCloneUtil fetches requested branch and sets shallow level', async () => {
    const { ensureShallowCloneUtil } = await import('../../src/worker/workers/repos.js');
    const resolveBranchName = vi.fn().mockResolvedValue('feature');
    git.listRemotes.mockResolvedValue([{ remote: 'origin', url: 'https://example/repo.git' }]);
    git.fetch.mockResolvedValue(undefined);
    git.checkout.mockResolvedValue(undefined);
    const repoId = 'team/repo';
    const key = parseRepoId(repoId);
    clonedRepos.add(key);

    const res = await ensureShallowCloneUtil(
      git,
      { repoId, branch: 'feature' },
      { rootDir, parseRepoId, repoDataLevels, clonedRepos, isRepoCloned, resolveBranchName },
      sendProgress
    );

    expect((res as any).success).toBe(true);
    expect((res as any).branch).toBe('feature');
    expect(repoDataLevels.get(key)).toBe('shallow');
    const fetchInit = git.fetch.mock.calls[0][0];
    expect(fetchInit.ref).toBe('feature');
    expect(fetchInit.depth).toBe(1);
  });
});
