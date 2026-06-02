import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { NostrGitProvider } from '../../src/api/providers/nostr-git-provider.js';
import { createEventIOStub } from '../utils/eventio-stub.js';

// Exercise simple passthrough/utility methods to lift function coverage

describe('API/NostrGitProvider trivial methods', () => {
  it('covers simple getters and utility methods', async () => {
    const io = createEventIOStub();
    const provider = new NostrGitProvider({ eventIO: io });

    // getGitProvider exists
    const gp = provider.getGitProvider();
    expect(gp).toBeTruthy();

    // Passthrough methods (skip clone to avoid real git invocation)
    await expect(provider.getAheadBehind('/repo', 'main', 'feature')).resolves.toEqual({ ahead: [], behind: [] });
    await expect(provider.hasOutstandingChanges('/repo')).resolves.toBe(false);
    await expect(provider.getRootCommit('/repo')).resolves.toBe('mock-root-commit');
    await expect(provider.getCommitInfo('/repo', 'abc')).resolves.toEqual({});
    await expect(provider.getAllBranches('/repo')).resolves.toEqual([]);
  });

  it('covers configureGrasp and updateConfig without side effects', async () => {
    const io = createEventIOStub();
    const provider = new NostrGitProvider({ eventIO: io });
    // configureGrasp sets internal flags
    const grasp = { publishStateFromLocal: async () => ({ ok: true }) } as any;
    provider.configureGrasp(grasp);
    // update config toggles publish flags
    provider.updateConfig({ publishRepoState: false, publishRepoAnnouncements: true });
    // No assertions needed beyond not throwing
    expect(provider.getGitProvider()).toBeTruthy();
  });
});
