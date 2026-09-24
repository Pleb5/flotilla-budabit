// Isolated test identities, never connected to a user account or published.
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import type { EventTemplate } from 'nostr-tools';
import type { RepoContext } from './context.js';
export const testKey = (n = 1): Uint8Array =>
  Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? n : 0));
export const testPubkey = (n = 1): string => getPublicKey(testKey(n));
export const signed = (event: Partial<EventTemplate> = {}, n = 1) =>
  finalizeEvent(
    {
      kind: 32267,
      created_at: 100,
      content: '',
      tags: [
        ['d', 'app'],
        ['name', 'App'],
        ['a', `30617:${testPubkey()}:repo`],
      ],
      ...event,
    },
    testKey(n)
  );
export const testRepo = (): RepoContext => ({
  repoPubkey: testPubkey(),
  repoName: 'repo',
  repoAddress: `30617:${testPubkey()}:repo`,
  repoNaddr: '',
  repoRelays: ['wss://relay.example'],
  maintainers: [testPubkey()],
  userPubkey: testPubkey(),
});
export const releaseFixture = (event: Partial<EventTemplate> = {}, n = 1) =>
  signed(
    {
      kind: 30063,
      tags: [
        ['d', 'app@1'],
        ['i', 'app'],
        ['version', '1'],
        ['c', 'main'],
        ['a', `32267:${testPubkey()}:app`],
        ['e', 'a'.repeat(64)],
      ],
      ...event,
    },
    n
  );
