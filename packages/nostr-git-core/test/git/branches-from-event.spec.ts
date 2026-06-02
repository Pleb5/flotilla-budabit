import { describe, it, expect, vi } from 'vitest';

// Mock events helpers used by listBranchesFromEvent
vi.mock('../../src/events/index.js', () => ({
  assertRepoAnnouncementEvent: (_evt: any) => {},
  parseRepoAnnouncementEvent: (_evt: any) => ({ repoId: 'owner/repo', name: 'repo' }),
}));

// Mock getGitProvider to control branch listing
vi.mock('../../src/api/git-provider.js', () => ({
  getGitProvider: () => ({
    listBranches: async (args: any) => (args && args.remote === 'origin' ? ['origin/feature'] : ['main']),
  }),
}));

const { listBranchesFromEvent } = await import('../../src/git/branches.js');

describe('git/branches: listBranchesFromEvent', () => {
  it('merges local and remote branches and strips origin/ prefix', async () => {
    const branches = await listBranchesFromEvent({ repoEvent: { kind: 30617, pubkey: 'p' } as any });
    const names = branches.map((b: any) => b.name).sort();
    expect(names).toEqual(['feature', 'main']);
  });
});
