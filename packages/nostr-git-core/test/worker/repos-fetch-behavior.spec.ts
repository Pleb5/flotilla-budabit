import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';

// Mock auth to ensure onAuth callback is provided
vi.mock('../../src/worker/workers/auth.js', () => ({
  getAuthCallback: (url: string) => () => ({ username: 'u', password: 'p' }),
  setAuthConfig: vi.fn(),
}));

const { smartInitializeRepoUtil, ensureShallowCloneUtil } = await import('../../src/worker/workers/repos.js');

function makeRecordingGit(overrides: any = {}) {
  const record: any = { lastFetchArgs: null };
  const git: any = {
    async listBranches() { return overrides.branches ?? ['main']; },
    async resolveRef({ ref }: any) { return overrides.refs?.[ref] ?? 'deadbeef'.padEnd(40, '0'); },
    async listRemotes() { return overrides.remotes ?? [{ remote: 'origin', url: 'https://example.com/x/y.git' }]; },
    async fetch(args: any) { record.lastFetchArgs = args; if (overrides.fetchErr) throw new Error(overrides.fetchErr); },
    async clone() { if (overrides.cloneErr) throw new Error(overrides.cloneErr); },
    async checkout() {},
    async writeRef() {},
    async listServerRefs({ url }: any) { if (overrides.noRefs) return []; return [{ ref: 'refs/heads/main' }]; },
  };
  return { git, record };
}

describe('worker repos fetch behavior', () => {
  it('smartInitializeRepoUtil uses shallow depth (50) when not full', async () => {
    const { git, record } = makeRecordingGit({});
    const res = await smartInitializeRepoUtil(
      git,
      { init: async () => {}, getRepoCache: async () => null, setRepoCache: async () => {} } as any,
      { repoId: 'owner/name', cloneUrls: ['https://example.com/owner/name.git'] },
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
    expect(res.success).toBe(true);
    expect(record.lastFetchArgs?.depth).toBe(50);
    expect(record.lastFetchArgs?.ref).toBeUndefined();
  });

  it('ensureShallowCloneUtil passes onAuth callback when origin remote present', async () => {
    const { git, record } = makeRecordingGit({});
    const res = await ensureShallowCloneUtil(
      git,
      { repoId: 'owner/name' },
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
    expect(typeof record.lastFetchArgs?.onAuth).toBe('function');
    expect(record.lastFetchArgs?.url).toBe('https://example.com/x/y.git');
  });

  it('smartInitializeRepoUtil returns limited success when branch resolution fails (empty repo)', async () => {
    const { git } = makeRecordingGit({});
    const res = await smartInitializeRepoUtil(
      git,
      { getRepoCache: async () => null, setRepoCache: async () => {}, init: async () => {}, } as any,
      { repoId: 'owner/name', cloneUrls: ['https://example.com/owner/name.git'] },
      {
        rootDir: '/root',
        parseRepoId: (id: string) => id.replace('/', ':'),
        repoDataLevels: new Map(),
        clonedRepos: new Set(['owner:name']),
        isRepoCloned: async () => true,
        resolveBranchName: async () => { throw new Error('no branches'); },
      },
      () => {}
    );
    expect(res.success).toBe(true);
    expect((res as any).fromCache).toBe(false);
    expect((res as any).dataLevel).toBe('refs');
    expect((res as any).warning).toMatch(/no branches|empty/i);
  });
});
