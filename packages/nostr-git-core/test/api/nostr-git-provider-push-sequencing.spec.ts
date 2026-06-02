import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NostrGitProvider } from '../../src/api/providers/nostr-git-provider.js';

/**
 * Verify sequencing: push -> grasp.publishStateFromLocal (when requested) -> Blossom mirror
 */
describe('NostrGitProvider push sequencing with GRASP + Blossom', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeProvider() {
    const order: string[] = [];

    const mockGitProvider = {
      push: vi.fn().mockImplementation(async () => { order.push('push'); return {}; })
    } as any;

    const eventIO = { publishEvent: vi.fn().mockResolvedValue({ ok: true, relays: ['wss://relay.example'] }), fetchEvents: vi.fn() } as any;

    const provider = new NostrGitProvider({ eventIO, gitProvider: mockGitProvider });

    const mockGrasp = {
      publishStateFromLocal: vi.fn().mockImplementation(async () => { order.push('grasp'); return 'evt'; })
    };

    provider.configureGrasp(mockGrasp as any);

    const fs = {
      pushToBlossom: vi.fn().mockImplementation(async () => { order.push('blossom'); return { total: 0, uploaded: 0, skipped: 0, failures: [] }; })
    };

    return { provider, mockGitProvider, mockGrasp, fs, order };
  }

  it('calls push -> grasp.publishStateFromLocal -> blossom mirror in order and returns stateEventId', async () => {
    const { provider, mockGitProvider, mockGrasp, fs, order } = makeProvider();

    const options = {
      dir: '/tmp/repo',
      fs,
      refspecs: ['refs/heads/main'],
      repoId: 'test-repo',
      repoAddr: '31990:npub1test:test-repo',
      blossomMirror: true,
      publishRepoStateFromLocal: true,
      ownerPubkey: 'npub1test'
    };

    const res = await provider.push(options);

    expect(mockGitProvider.push).toHaveBeenCalled();
    expect(mockGrasp.publishStateFromLocal).toHaveBeenCalled();
    expect(fs.pushToBlossom).toHaveBeenCalled();

    expect(order).toEqual(['push', 'grasp', 'blossom']);
    expect(res.stateEventId).toBe('wss://relay.example');
  });
});
