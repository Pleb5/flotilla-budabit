import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

// We will mock the git provider used by ensureRepoFromEvent
const makeGit = () => ({
  // Used by isRepoCloned (HEAD) and resolveBranchToOid (branch refs)
  async resolveRef({ ref }: any) {
    // Return a dummy oid for any ref queried
    if (ref) return 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    throw new Error('missing ref');
  },
  async fetch() {
    throw new Error('fetch failed');
  },
  // Some helper APIs referenced by other codepaths (not hit here)
  async listRefs() { return []; },
});

// Mock module before importing ensureRepoFromEvent
vi.mock('../../src/api/git-provider.js', () => ({
  getGitProvider: () => makeGit(),
}));

const { ensureRepoFromEvent } = await import('../../src/git/git.js');

describe('ensureRepoFromEvent deepen path error handling', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('swallows fetch errors during deepen and continues without throwing', async () => {
    const repoEvent = {
      repoId: 'npub1dummy',
      owner: 'owner',
      repo: 'name',
      host: 'example.com',
      clone: ['https://example.com/owner/name.git'],
    } as any;

    await expect(
      ensureRepoFromEvent({ repoEvent, branch: 'main', repoKey: 'owner:name' }, 5)
    ).resolves.toBeUndefined();

    // Verify the outer catch path logged a warning about deepening failure
    expect(warnSpy).toHaveBeenCalled();
    const joined = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toMatch(/Failed to deepen repository/);
  });
});
