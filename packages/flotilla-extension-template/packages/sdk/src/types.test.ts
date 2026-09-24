import { describe, it, expect } from 'vitest';
import {
  UnsignedEventSchema,
  WidgetContextSchema,
  WidgetRequestMessageSchema,
  WidgetResponseMessageSchema,
  WidgetEventMessageSchema,
  WidgetWireMessageSchema,
  SmartWidgetNostrEventSchema,
  getHostActionSupport,
  getHostFeatureSupport,
} from './types.js';
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

describe('community context contract', () => {
  it('exposes explicit V2 identity and exact branch fields', () => {
    expect(communityContextContract).toMatchObject({
      version: 2,
      communityId: 'community-id',
      ownerPubkey: 'owner-pubkey',
      definitionAddress: '32222:owner-pubkey:community-id',
      naddr: 'naddr1definition',
    });
    expect(communityContextContract).not.toHaveProperty('pubkey');
    expect(communityContextContract).not.toHaveProperty('ncommunity');
  });
});

describe('host capability helpers', () => {
  it('keeps support unknown when an old host omits the catalog', () => {
    expect(getHostActionSupport({}, 'nostr:subscribe')).toBe('unknown');
    expect(getHostFeatureSupport({}, 'nostr.subscriptionEose')).toBe('unknown');
  });

  it('reports advertised actions and features from widget:init', () => {
    const payload = {
      capabilities: {
        schemaVersion: 1,
        protocolVersion: 1,
        actions: ['nostr:subscribe'],
        features: {
          'nostr.subscriptionEose': 'per-relay',
          'media.camera': false,
        },
      },
    };

    expect(getHostActionSupport(payload, 'nostr:subscribe')).toBe('supported');
    expect(getHostActionSupport(payload, 'nostr:query')).toBe('unsupported');
    expect(getHostFeatureSupport(payload, 'nostr.subscriptionEose')).toBe('supported');
    expect(getHostFeatureSupport(payload, 'media.camera')).toBe('unsupported');
    expect(getHostFeatureSupport(payload, 'future.feature')).toBe('unsupported');
  });
});

describe('Zod schemas', () => {
  describe('UnsignedEventSchema', () => {
    it('should validate a correct unsigned event', () => {
      const result = UnsignedEventSchema.safeParse({
        kind: 1,
        content: 'Hello',
        tags: [['p', 'abc']],
        created_at: 1700000000,
      });
      expect(result.success).toBe(true);
    });

    it('should accept optional pubkey', () => {
      const result = UnsignedEventSchema.safeParse({
        kind: 1,
        content: '',
        tags: [],
        created_at: 0,
        pubkey: 'hex-pubkey',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      expect(UnsignedEventSchema.safeParse({ kind: 1 }).success).toBe(false);
      expect(UnsignedEventSchema.safeParse({ content: 'hi' }).success).toBe(false);
      expect(UnsignedEventSchema.safeParse({}).success).toBe(false);
    });

    it('should reject wrong types', () => {
      const result = UnsignedEventSchema.safeParse({
        kind: 'one',
        content: 123,
        tags: 'not-an-array',
        created_at: 'now',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('WidgetContextSchema', () => {
    it('should validate a context with known fields', () => {
      const result = WidgetContextSchema.safeParse({
        contextId: 'room-123',
        userPubkey: 'pk-abc',
        relays: ['wss://relay.example.com'],
      });
      expect(result.success).toBe(true);
    });

    it('should allow extra fields (catchall)', () => {
      const result = WidgetContextSchema.safeParse({
        contextId: 'room-123',
        customField: 42,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.customField).toBe(42);
      }
    });

    it('should accept empty object', () => {
      expect(WidgetContextSchema.safeParse({}).success).toBe(true);
    });
  });

  describe('WidgetWireMessageSchema', () => {
    it('should validate a request message', () => {
      const result = WidgetRequestMessageSchema.safeParse({
        type: 'request',
        id: 'req-1',
        action: 'nostr:publish',
        payload: { kind: 1, content: '' },
      });
      expect(result.success).toBe(true);
    });

    it('should validate a response message', () => {
      const result = WidgetResponseMessageSchema.safeParse({
        type: 'response',
        id: 'req-1',
        action: 'nostr:publish',
        payload: { status: 'ok' },
      });
      expect(result.success).toBe(true);
    });

    it('should validate an event message', () => {
      const result = WidgetEventMessageSchema.safeParse({
        type: 'event',
        action: 'widget:init',
        payload: { pubkey: 'abc' },
      });
      expect(result.success).toBe(true);
    });

    it('should validate any wire message via union', () => {
      expect(
        WidgetWireMessageSchema.safeParse({
          type: 'request',
          id: 'r1',
          action: 'ui:toast',
        }).success
      ).toBe(true);

      expect(
        WidgetWireMessageSchema.safeParse({
          type: 'event',
          action: 'context:update',
        }).success
      ).toBe(true);
    });

    it('should reject invalid message types', () => {
      expect(
        WidgetWireMessageSchema.safeParse({
          type: 'unknown',
          action: 'test',
        }).success
      ).toBe(false);
    });

    it('should reject messages missing action', () => {
      expect(
        WidgetWireMessageSchema.safeParse({
          type: 'request',
          id: 'r1',
        }).success
      ).toBe(false);
    });
  });

  describe('SmartWidgetNostrEventSchema', () => {
    it('should validate a kind 30033 event', () => {
      const result = SmartWidgetNostrEventSchema.safeParse({
        kind: 30033,
        content: 'My Widget',
        tags: [
          ['d', 'my-widget'],
          ['l', 'tool'],
          ['permission', 'nostr:publish'],
        ],
        created_at: 1700000000,
      });
      expect(result.success).toBe(true);
    });

    it('should reject wrong kind', () => {
      const result = SmartWidgetNostrEventSchema.safeParse({
        kind: 1,
        content: 'Not a widget',
        tags: [],
        created_at: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should accept optional pubkey, id, sig', () => {
      const result = SmartWidgetNostrEventSchema.safeParse({
        kind: 30033,
        content: 'Widget',
        tags: [],
        created_at: 0,
        pubkey: 'hex',
        id: 'eventid',
        sig: 'signature',
      });
      expect(result.success).toBe(true);
    });
  });
});
