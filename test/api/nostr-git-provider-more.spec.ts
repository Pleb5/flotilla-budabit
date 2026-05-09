import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { NostrGitProvider } from '../../src/api/providers/nostr-git-provider.js';
import { createEventIOStub, type EventIOStub } from '../utils/eventio-stub.js';

function announcementEvent(repoId: string) {
  return {
    kind: 30617,
    tags: [
      ['d', repoId],
      ['clone', 'https://example.com/owner/repo.git'],
      ['maintainers', 'npub1alice'],
      ['relays', 'wss://relay.example.com']
    ],
    content: '',
    created_at: Math.floor(Date.now() / 1000),
  } as any;
}

describe('API/NostrGitProvider additional paths', () => {
  it('discoverRepo returns announcement with urls and no state when no state events found', async () => {
    const repoId = 'owner/repo';
    const io = createEventIOStub({
      fetchRules: [
        { matcher: (filters) => filters?.some((f: any) => f?.kinds?.includes(30617) && f?.['#d']?.includes(repoId)), events: [announcementEvent(repoId)] },
        { matcher: (filters) => filters?.some((f: any) => f?.kinds?.includes(30618) && f?.['#d']?.includes(repoId)), events: [] },
      ],
    });

    const provider = new NostrGitProvider({ eventIO: io });
    const res = await provider.discoverRepo(repoId);

    expect(res).toBeTruthy();
    expect(res?.repoId).toBe(repoId);
    expect((res?.urls || []).length).toBeGreaterThan(0);
    expect(res?.state).toBeUndefined();
  });

  it('listProposals failure returns empty array', async () => {
    const io = createEventIOStub();
    // Force fetchEvents to throw
    (io as any).fetchEvents = async () => { throw new Error('network down'); };

    const provider = new NostrGitProvider({ eventIO: io });
    const res = await provider.listProposals('30617:addr');
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(0);
  });

  it('sendProposal rejects because legacy patch proposals were removed', async () => {
    const io = createEventIOStub();
    const provider = new NostrGitProvider({ eventIO: io });
    await expect(provider.sendProposal('30617:addr', ['c1'])).rejects.toThrow(
      /legacy patch events/,
    );
  });

  it('publishRepoState success returns relay string', async () => {
    const io = createEventIOStub();
    const provider = new NostrGitProvider({ eventIO: io });
    const relay = await provider.publishRepoState('/repo');
    expect(typeof relay).toBe('string');
    expect(relay).toBe('test-relay');
  });

  it('publishRepoAnnouncement success returns relay string', async () => {
    const io = createEventIOStub();
    const provider = new NostrGitProvider({ eventIO: io });
    const relay = await provider.publishRepoAnnouncement('/repo');
    expect(typeof relay).toBe('string');
    expect(relay).toBe('test-relay');
  });
});
