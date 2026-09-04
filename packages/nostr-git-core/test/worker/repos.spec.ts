import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  clearCloneTracking,
  initializeRepoUtil,
  ensureShallowCloneUtil,
  ensureFullCloneUtil,
  smartInitializeRepoUtil,
} from '../../src/worker/workers/repos.js';

function makeCache() {
  let cache: any | null = null;
  return {
    obj: {
      async init() {},
      async getRepoCache(key: string) { return cache && cache.repoId === key ? cache : null; },
      async setRepoCache(c: any) { cache = c; },
    },
    set(c: any) { cache = c; },
    get() { return cache; },
  };
}

function makeGit(overrides: any = {}) {
  return {
    async listBranches() { return overrides.branches ?? ['main']; },
    async resolveRef({ ref }: any) { 
      if (overrides.refs !== undefined) {
        const oid = overrides.refs[ref];
        if (oid === undefined) throw new Error(`Could not find ${ref}`);
        return oid;
      }
      return 'deadbeef'.padEnd(40, '0'); 
    },
    async listRemotes() { return overrides.remotes ?? [{ remote: 'origin', url: 'https://example.com/x/y.git' }]; },
    async fetch(options: any) {
      if (overrides.fetch) return await overrides.fetch(options);
      if (overrides.fetchErr) throw new Error(overrides.fetchErr);
    },
    async clone(options: any) {
      if (overrides.clone) return await overrides.clone(options);
      if (overrides.cloneErr) throw new Error(overrides.cloneErr);
    },
    async addRemote() {},
    async setConfig() {},
    async checkout() {},
    async writeRef() {},
    async listServerRefs({ url }: any) { if (overrides.noRefs) return []; return [{ ref: 'refs/heads/main' }]; },
  } as any;
}

describe('worker/repos quick tests', () => {
  it('clearCloneTracking empties sets and maps', () => {
    const set = new Set(['a']);
    const map = new Map([['k', 'refs']]);
    clearCloneTracking(set, map as any);
    expect(set.size).toBe(0);
    expect(map.size).toBe(0);
  });

  it('ensureFullCloneUtil returns error when fetch fails', async () => {
    const git = makeGit({ 
      fetchErr: 'network fail',
      refs: {} // No refs available, so resolveExistingBranchCommit will return null
    });
    const repoDataLevels = new Map<string, any>([['owner:name', 'refs']]);
    const res = await ensureFullCloneUtil(
      git,
      { repoId: 'owner/name' },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels,
        clonedRepos: new Set(['owner:name']),
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main',
      },
      () => {}
    );
    expect(res.success).toBe(false);
    expect(String((res as any).error)).toMatch(/network fail/);
  });

  it('strict full clone rejects fetch failure even when a local branch exists', async () => {
    const res = await ensureFullCloneUtil(
      makeGit({fetchErr: 'scoped remote failed'}),
      {
        repoId: 'owner/name',
        branch: 'main',
        cloneUrls: ['https://authorized.example/owner/name.git'],
        strictCloneUrls: true,
      },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels: new Map([['owner:name', 'full']]),
        clonedRepos: new Set(['owner:name']),
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main',
      },
      () => {}
    );

    expect(res.success).toBe(false);
    expect((res as any).localOnly).toBeUndefined();
    expect((res as any).error).toMatch(/scoped remote failed/);
  });

  it('strict full clone returns the exact fetched branch OID', async () => {
    const remoteOid = 'a'.repeat(40);
    const res = await ensureFullCloneUtil(
      makeGit({fetch: async () => ({fetchHead: remoteOid})}),
      {
        repoId: 'owner/name',
        branch: 'main',
        cloneUrls: ['https://authorized.example/owner/name.git'],
        strictCloneUrls: true,
      },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels: new Map([['owner:name', 'refs']]),
        clonedRepos: new Set(['owner:name']),
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main',
      },
      () => {}
    );

    expect(res).toMatchObject({success: true, headCommit: remoteOid});
  });

  it('ensureFullCloneUtil resolves requested branches in strict mode', async () => {
    const resolveBranchName = vi.fn(async (_dir: string, requested?: string) => requested || 'main');
    const repoDataLevels = new Map<string, any>([['owner:name', 'refs']]);

    const res = await ensureFullCloneUtil(
      makeGit(),
      { repoId: 'owner/name', branch: 'dev', cloneUrls: ['https://example.com/x/y.git'] },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels,
        clonedRepos: new Set(['owner:name']),
        isRepoCloned: async () => true,
        resolveBranchName,
      },
      () => {}
    );

    expect(res.success).toBe(true);
    expect(resolveBranchName).toHaveBeenCalledWith('/root/owner:name', 'dev', { strict: true });
  });

  it('smartInitializeRepoUtil sync path uses HEAD when writeRef fails', async () => {
    const headOid = 'head'.padEnd(40, 'h');
    const git = makeGit({
      refs: {
        'refs/remotes/origin/main': 'orig'.padEnd(40, 'o'),
        HEAD: headOid,
      },
    });
    // Override writeRef to throw to trigger HEAD fallback
    (git as any).writeRef = async () => { throw new Error('write failed'); };
    const cache = makeCache();
    const res = await smartInitializeRepoUtil(
      git,
      cache.obj as any,
      { repoId: 'owner/name', cloneUrls: ['https://example.com/owner/name.git'] },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels: new Map(),
        clonedRepos: new Set(['owner:name']),
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main',
      },
      () => {}
    );
    expect(res.success).toBe(true);
    expect((res as any).synced).toBe(true);
    expect((res as any).headCommit).toBe(headOid);
  });

  it('ensureShallowCloneUtil returns fromCache when level already shallow/full', async () => {
    const git = makeGit();
    const repoDataLevels = new Map<string, any>([['owner:name', 'shallow']]);
    const res = await ensureShallowCloneUtil(
      git,
      { repoId: 'owner/name' },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels,
        clonedRepos: new Set(['owner:name']),
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main',
      },
      () => {}
    );
    expect(res.success).toBe(true);
    expect((res as any).fromCache).toBe(true);
  });

  it('ensureShallowCloneUtil returns not initialized when repo missing', async () => {
    const git = makeGit();
    const res = await ensureShallowCloneUtil(
      git,
      { repoId: 'owner/name' },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels: new Map(),
        clonedRepos: new Set(),
        isRepoCloned: async () => false,
        resolveBranchName: async () => 'main',
      },
      () => {}
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Repository not initialized/);
  });

  it('initializeRepoUtil returns corsError payload when clone fails due to CORS', async () => {
    const git = makeGit({ cloneErr: 'CORS blocked' });
    const cache = makeCache();
    const res = await initializeRepoUtil(
      git,
      cache.obj as any,
      { repoId: 'owner/name', cloneUrls: ['https://example.com/owner/name.git'] },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels: new Map(),
        clonedRepos: new Set(),
      },
      () => {}
    );
    expect(res.success).toBe(false);
    expect((res as any).corsError).toBe(true);
    expect(String((res as any).error)).toMatch(/CORS\/network/);
  });

  it('smartInitializeRepoUtil returns cached data without hitting git when cache exists', async () => {
    const git = makeGit();
    const cache = makeCache();
    const key = 'owner:name';
    cache.set({
      repoId: key,
      dataLevel: 'refs',
      headCommit: 'deadbeef'.padEnd(40, '0'),
      branches: [{ name: 'main', commit: 'deadbeef'.padEnd(40, '0') }],
      cloneUrls: ['https://example.com/owner/name.git'],
      lastUpdated: Date.now(),
    });
    const res = await smartInitializeRepoUtil(
      git,
      cache.obj as any,
      { repoId: 'owner/name', cloneUrls: ['https://example.com/owner/name.git'] },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels: new Map(),
        clonedRepos: new Set(),
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main',
      },
      () => {}
    );
    expect(res.success).toBe(true);
    expect((res as any).fromCache).toBe(true);
    expect((res as any).branches?.[0]?.name).toBe('main');
  });

  it('smartInitializeRepoUtil ignores stale cache when local clone is missing', async () => {
    const clone = vi.fn();
    const git = makeGit({ clone });
    const cache = makeCache();
    const key = 'owner:name';
    cache.set({
      repoId: key,
      dataLevel: 'refs',
      headCommit: 'deadbeef'.padEnd(40, '0'),
      branches: [{ name: 'main', commit: 'deadbeef'.padEnd(40, '0') }],
      cloneUrls: ['https://example.com/owner/name.git'],
      lastUpdated: Date.now(),
    });
    const progress: string[] = [];
    const res = await smartInitializeRepoUtil(
      git,
      cache.obj as any,
      { repoId: 'owner/name', cloneUrls: ['https://example.com/owner/name.git'] },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels: new Map(),
        clonedRepos: new Set(),
        isRepoCloned: async () => false,
        resolveBranchName: async () => 'main',
      },
      phase => progress.push(phase)
    );

    expect(res.success).toBe(true);
    expect((res as any).fromCache).toBe(false);
    expect(clone).toHaveBeenCalled();
    expect(progress).toContain('Cached metadata found, but local clone is missing');
  });

  it('strict smart initialization contacts only the supplied URL despite an existing clone', async () => {
    const cache = makeCache();
    cache.set({
      repoId: 'owner/name',
      dataLevel: 'full',
      branches: [{ name: 'main', commit: 'deadbeef'.padEnd(40, '0') }],
      headCommit: 'deadbeef'.padEnd(40, '0'),
      cloneUrls: ['https://unauthorized.example/owner/name.git'],
    });
    const fetch = vi.fn().mockResolvedValue({fetchHead: 'a'.repeat(40)});
    const git = makeGit({
      fetch,
      remotes: [{ remote: 'origin', url: 'https://unauthorized.example/owner/name.git' }],
    });

    const result = await smartInitializeRepoUtil(
      git,
      cache.obj as any,
      {
        repoId: 'owner:name',
        cloneUrls: ['https://authorized.example/owner/name.git'],
        strictCloneUrls: true,
      },
      {
        rootDir: '/repos',
        parseRepoId: () => 'owner/name',
        repoDataLevels: new Map([['owner/name', 'full' as const]]),
        clonedRepos: new Set(['owner/name']),
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main',
      },
      () => {},
    );

    expect(result.success).toBe(true);
    expect((result as any).headCommit).toBe('a'.repeat(40));
    expect(fetch).toHaveBeenCalled();
    expect(fetch.mock.calls.every(([options]) => options.url === 'https://authorized.example/owner/name.git')).toBe(true);
  });

  it('ensureShallowCloneUtil happy path fetches and checks out branch', async () => {
    const git = makeGit();
    const repoDataLevels = new Map<string, any>();
    const res = await ensureShallowCloneUtil(
      git,
      { repoId: 'owner/name' },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels,
        clonedRepos: new Set(['owner:name']),
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main',
      },
      () => {}
    );
    expect(res.success).toBe(true);
    expect(res.dataLevel).toBe('shallow');
  });

  it('ensureFullCloneUtil returns cached=true when already full', async () => {
    const git = makeGit();
    const repoDataLevels = new Map<string, any>([['owner:name', 'full']]);
    const res = await ensureFullCloneUtil(
      git,
      { repoId: 'owner/name' },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels,
        clonedRepos: new Set(['owner:name']),
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main',
      },
      () => {}
    );
    expect(res.success).toBe(true);
    expect((res as any).cached).toBe(true);
    expect((res as any).level).toBe('full');
  });

  it('ensureFullCloneUtil fetch success marks level full', async () => {
    const git = makeGit();
    const repoDataLevels = new Map<string, any>([['owner:name', 'refs']]);
    const res = await ensureFullCloneUtil(
      git,
      { repoId: 'owner/name', depth: 20 },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels,
        clonedRepos: new Set(['owner:name']),
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main',
      },
      () => {}
    );
    expect(res.success).toBe(true);
    expect((res as any).level).toBe('full');
  });

  it('ensureFullCloneUtil reports error when origin remote missing', async () => {
    const git = makeGit({ remotes: [] });
    const repoDataLevels = new Map<string, any>([['owner:name', 'refs']]);
    const res = await ensureFullCloneUtil(
      git,
      { repoId: 'owner/name' },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels,
        clonedRepos: new Set(['owner:name']),
        isRepoCloned: async () => true,
        resolveBranchName: async () => 'main',
      },
      () => {}
    );
    expect(res.success).toBe(false);
    expect(String((res as any).error)).toMatch(/Origin remote not found/);
  });
});
