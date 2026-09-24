import { describe, expect, it } from 'vitest';
import { getHostActionSupport, getHostFeatureSupport } from './types.js';
import type { CommunityWidgetContext } from './types.js';

const communityContextContract: CommunityWidgetContext = {
  version: 2,
  contextSessionId: 'session',
  contextVersion: 1,
  communityId: 'community-id',
  ownerPubkey: 'owner-pubkey',
  definitionAddress: '32222:owner-pubkey:community-id',
  naddr: 'naddr1definition',
  relays: [],
  relayHints: [],
  blossomServers: [],
  sections: [],
  viewer: { isOwner: false, isBanned: false },
};

it('exports the explicit V2 community context contract', () => {
  expect(communityContextContract.version).toBe(2);
  expect(communityContextContract.definitionAddress).toContain('32222:');
  expect(communityContextContract).not.toHaveProperty('pubkey');
  expect(communityContextContract).not.toHaveProperty('ncommunity');
});

describe('host capability helpers', () => {
  it('keeps old hosts unknown and reads advertised support', () => {
    expect(getHostActionSupport({}, 'nostr:subscribe')).toBe('unknown');
    expect(getHostFeatureSupport({}, 'nostr.subscriptionEose')).toBe('unknown');

    const payload = {
      capabilities: {
        schemaVersion: 1,
        protocolVersion: 1,
        actions: ['nostr:subscribe'],
        features: { 'nostr.subscriptionEose': 'per-relay' },
      },
    };
    expect(getHostActionSupport(payload, 'nostr:subscribe')).toBe('supported');
    expect(getHostActionSupport(payload, 'nostr:query')).toBe('unsupported');
    expect(getHostFeatureSupport(payload, 'nostr.subscriptionEose')).toBe('supported');
  });
});
