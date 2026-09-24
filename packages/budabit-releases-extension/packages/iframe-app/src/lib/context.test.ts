import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { normalizeContext, normalizeRelays, isMaintainer } from './context.js';
import { testPubkey, testRepo } from './test-fixtures.js';

describe('host context', () => {
  it('separates encoded naddr from exact coordinate and recovers viewer', () => {
    const repo = testRepo();
    const naddr = nip19.naddrEncode({ kind: 30617, pubkey: repo.repoPubkey, identifier: 'repo' });
    const result = normalizeContext({
      status: 'ok',
      repoContext: {
        pubkey: repo.repoPubkey,
        name: 'repo',
        displayName: 'Not the identifier',
        naddr,
        address: repo.repoAddress,
        userPubkey: repo.userPubkey,
        relays: repo.repoRelays,
      },
    });
    expect(result).toEqual({ ...repo, repoNaddr: naddr });
  });
  it('accepts legacy/flat context and explicit account changes and clears', () => {
    const repo = testRepo();
    expect(normalizeContext({ repo, userPubkey: testPubkey(2) })?.userPubkey).toBe(testPubkey(2));
    expect(normalizeContext({ repo, userPubkey: null }, repo.userPubkey)?.userPubkey).toBe('');
    expect(normalizeContext({ repoContext: null })).toBeNull();
    expect(normalizeContext(null)).toBeNull();
    expect(isMaintainer({ ...repo, userPubkey: testPubkey(2) })).toBe(false);
  });
  it('rejects inconsistent or malformed identity; includes owner in trust', () => {
    expect(normalizeContext({ ...testRepo(), repoAddress: '30617:other:repo' })).toBeNull();
    expect(normalizeContext({ ...testRepo(), repoNaddr: 'naddr1fake' })).toBeNull();
    expect(normalizeContext({ ...testRepo(), maintainers: [] })?.maintainers).toEqual([
      testPubkey(),
    ]);
    expect(
      normalizeRelays(['javascript:evil', 'wss://relay.example/', 'wss://relay.example', null])
    ).toEqual(['wss://relay.example']);
  });
});
