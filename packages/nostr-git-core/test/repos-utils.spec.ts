import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitProvider } from '../src/git/provider.js';
import {
  initializeRepoUtil,
  ensureShallowCloneUtil,
  ensureFullCloneUtil,
  smartInitializeRepoUtil
} from '../src/worker/workers/repos.js';

// Simple helpers/mocks
const parseRepoId = (id: string) => id.replace(/\s+/g, '-').toLowerCase();

function makeGitMock(partial: Partial<GitProvider> = {}): GitProvider {
  return {
    // clone/init
    clone: vi.fn().mockResolvedValue(undefined),
    listBranches: vi.fn().mockResolvedValue(['main']),
    resolveRef: vi.fn().mockResolvedValue('abcdef1234567890'),
    // fetch/checkout
    listRemotes: vi
      .fn()
      .mockResolvedValue([{ remote: 'origin', url: 'https://example.com/repo.git' }]),
    fetch: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    // write and others
    writeRef: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue([]),
    statusMatrix: vi.fn().mockResolvedValue([] as any),
    ...partial
  } as unknown as GitProvider;
}

function makeCacheMock(initial?: any) {
  let stored: any = initial ?? null;
  return {
    getRepoCache: vi.fn(async (key: string) => (stored && stored.repoId === key ? stored : null)),
    setRepoCache: vi.fn(async (value: any) => {
      stored = value;
      return undefined;
    }),
    clearOldCache: vi.fn(async () => undefined),
    deleteRepoCache: vi.fn(async () => undefined)
  } as any;
}

const rootDir = '/tmp/root';

describe('repos utils', () => {
  let git: GitProvider;
  let cacheManager: any;
  let repoDataLevels: Map<string, 'refs' | 'shallow' | 'full'>;
  let clonedRepos: Set<string>;

  beforeEach(() => {
    git = makeGitMock();
    cacheManager = makeCacheMock();
    repoDataLevels = new Map();
    clonedRepos = new Set();
  });

  it('initializeRepoUtil should initialize refs and cache', async () => {
    const sendProgress = vi.fn();
    const res = await initializeRepoUtil(
      git,
      cacheManager,
      { repoId: 'Owner/Repo', cloneUrls: ['https://example.com/repo.git'] },
      { rootDir, parseRepoId, repoDataLevels, clonedRepos },
      sendProgress
    );

    expect(res.success).toBe(true);
    if (!res.success) {
      throw new Error(`initializeRepoUtil failed: ${JSON.stringify(res)}`);
    }
    expect('dataLevel' in res && res.dataLevel === 'refs').toBe(true);
    expect(repoDataLevels.get(parseRepoId('Owner/Repo'))).toBe('refs');
    expect(clonedRepos.has(parseRepoId('Owner/Repo'))).toBe(true);
    expect(cacheManager.setRepoCache).toHaveBeenCalled();
  });

  it('ensureShallowCloneUtil should fetch and checkout shallow for branch', async () => {
    const sendProgress = vi.fn();
    const repoId = 'Org/App';
    // Pretend repo already exists (initialize)
    repoDataLevels.set(parseRepoId(repoId), 'refs');
    clonedRepos.add(parseRepoId(repoId));

    const res = await ensureShallowCloneUtil(
      git,
      { repoId, branch: 'main' },
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main'
      },
      sendProgress
    );

    expect(res.success).toBe(true);
    expect(res.dataLevel).toBe('shallow');
    expect(repoDataLevels.get(parseRepoId(repoId))).toBe('shallow');
    expect(git.fetch as any).toHaveBeenCalled();
    expect(git.checkout as any).toHaveBeenCalled();
  });

  it('ensureFullCloneUtil should set level full after fetch', async () => {
    const sendProgress = vi.fn();
    const repoId = 'Org/App2';
    repoDataLevels.set(parseRepoId(repoId), 'shallow');
    clonedRepos.add(parseRepoId(repoId));

    const res = await ensureFullCloneUtil(
      git,
      { repoId, branch: 'main', depth: 100 },
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main'
      },
      (phase) => void phase
    );

    expect(res.success).toBe(true);
    expect(res.level).toBe('full');
    expect(repoDataLevels.get(parseRepoId(repoId))).toBe('full');
  });

  it('smartInitializeRepoUtil should return cached when available', async () => {
    const key = parseRepoId('X/Y');
    const cached = {
      repoId: key,
      lastUpdated: Date.now(),
      headCommit: 'abc',
      dataLevel: 'shallow' as const,
      branches: [{ name: 'main', commit: 'abc' }],
      cloneUrls: ['https://example.com/repo.git']
    };
    cacheManager = makeCacheMock(cached);

    const result = await smartInitializeRepoUtil(
      git,
      cacheManager,
      { repoId: 'X/Y', cloneUrls: cached.cloneUrls },
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main'
      },
      () => {}
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`smartInitializeRepoUtil failed: ${JSON.stringify(result)}`);
    }
    expect(result.fromCache).toBe(true);
    expect('dataLevel' in result && result.dataLevel === 'shallow').toBe(true);
    expect(repoDataLevels.get(key)).toBe('shallow');
    expect(clonedRepos.has(key)).toBe(true);
  });
});
