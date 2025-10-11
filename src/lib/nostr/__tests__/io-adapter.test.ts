/**
 * Unit tests for the Flotilla Nostr I/O Adapter.
 * 
 * These tests verify that the adapter correctly delegates to the existing
 * Welshman/Flotilla infrastructure without creating new pools or connections.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEventIO, createSignEvent, getCurrentPubkey } from '../io-adapter';
import type { NostrEvent, NostrFilter } from '@nostr-git/shared-types';

// Mock the Welshman modules
vi.mock('@welshman/net', () => ({
  load: vi.fn(),
}));

vi.mock('@welshman/app', () => ({
  publishThunk: vi.fn(),
  signer: {
    get: vi.fn(),
  },
  pubkey: {
    get: vi.fn(),
  },
}));

vi.mock('@welshman/router', () => ({
  Router: {
    get: vi.fn(() => ({
      FromUser: vi.fn(() => ({
        getUrls: vi.fn(() => ['wss://relay1.example.com', 'wss://relay2.example.com']),
      })),
    })),
  },
}));

vi.mock('svelte/store', () => ({
  get: vi.fn((store) => {
    if (typeof store === 'object' && 'get' in store) {
      return store.get();
    }
    return undefined;
  }),
}));

import { load } from '@welshman/net';
import { publishThunk, signer } from '@welshman/app';
import { get } from 'svelte/store';

describe('io-adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createEventIO', () => {
    it('should create an IO instance with fetchEvents and publishEvent methods', () => {
      const io = createEventIO();
      
      expect(io).toBeDefined();
      expect(typeof io.fetchEvents).toBe('function');
      expect(typeof io.publishEvent).toBe('function');
    });

    describe('fetchEvents', () => {
      it('should delegate to Welshman load function', async () => {
        const mockEvents = [
          {
            id: 'event1',
            pubkey: 'pubkey1',
            created_at: 1234567890,
            kind: 1,
            tags: [],
            content: 'test',
            sig: 'sig1',
          },
        ];

        vi.mocked(load).mockResolvedValue(mockEvents as any);

        const io = createEventIO();
        const filters: NostrFilter[] = [
          { kinds: [30002], authors: ['pubkey1'], '#d': ['grasp-servers'] },
        ];

        const result = await io.fetchEvents(filters);

        expect(load).toHaveBeenCalledWith({
          relays: ['wss://relay1.example.com', 'wss://relay2.example.com'],
          filters: filters,
        });
        expect(result).toEqual(mockEvents);
      });

      it('should return empty array when no events found', async () => {
        vi.mocked(load).mockResolvedValue([]);

        const io = createEventIO();
        const result = await io.fetchEvents([{ kinds: [1] }]);

        expect(result).toEqual([]);
      });
    });

    describe('publishEvent', () => {
      it('should delegate to Welshman publishThunk', async () => {
        const mockEvent: NostrEvent = {
          id: 'event1',
          pubkey: 'pubkey1',
          created_at: 1234567890,
          kind: 30002,
          tags: [['d', 'grasp-servers']],
          content: '',
          sig: 'sig1',
        };

        const mockThunk = {
          result: Promise.resolve(),
        };

        vi.mocked(publishThunk).mockReturnValue(mockThunk as any);

        const io = createEventIO();
        const result = await io.publishEvent(mockEvent);

        expect(publishThunk).toHaveBeenCalledWith({
          event: mockEvent,
          relays: ['wss://relay1.example.com', 'wss://relay2.example.com'],
        });
        expect(result.ok).toBe(true);
        expect(result.relays).toEqual(['wss://relay1.example.com', 'wss://relay2.example.com']);
      });

      it('should return error when publish fails', async () => {
        const mockEvent: NostrEvent = {
          id: 'event1',
          pubkey: 'pubkey1',
          created_at: 1234567890,
          kind: 30002,
          tags: [],
          content: '',
          sig: 'sig1',
        };

        const mockThunk = {
          result: Promise.reject(new Error('Publish failed')),
        };

        vi.mocked(publishThunk).mockReturnValue(mockThunk as any);

        const io = createEventIO();
        const result = await io.publishEvent(mockEvent);

        expect(result.ok).toBe(false);
        expect(result.error).toBe('Publish failed');
      });
    });
  });

  describe('createSignEvent', () => {
    it('should create a signing function that uses Welshman signer', async () => {
      const mockSigner = {
        sign: vi.fn().mockResolvedValue({
          id: 'signed-id',
          pubkey: 'test-pubkey',
          created_at: 1234567890,
          kind: 30002,
          tags: [['d', 'test']],
          content: '',
          sig: 'signed-sig',
        }),
      };

      vi.mocked(signer.get).mockReturnValue(mockSigner as any);
      vi.mocked(get).mockReturnValue('test-pubkey');

      const signEvent = createSignEvent();
      
      const unsigned = {
        kind: 30002,
        created_at: 1234567890,
        tags: [['d', 'test']],
        content: '',
      };

      const result = await signEvent(unsigned);

      expect(signer.get).toHaveBeenCalled();
      expect(mockSigner.sign).toHaveBeenCalledWith({
        ...unsigned,
        pubkey: 'test-pubkey',
      });
      expect(result.sig).toBe('signed-sig');
    });

    it('should throw error when no signer is available', async () => {
      vi.mocked(signer.get).mockReturnValue(null as any);

      const signEvent = createSignEvent();
      
      const unsigned = {
        kind: 30002,
        created_at: 1234567890,
        tags: [],
        content: '',
      };

      await expect(signEvent(unsigned)).rejects.toThrow('No signer available');
    });

    it('should throw error when no pubkey is available', async () => {
      const mockSigner = { sign: vi.fn() };
      vi.mocked(signer.get).mockReturnValue(mockSigner as any);
      vi.mocked(get).mockReturnValue(null);

      const signEvent = createSignEvent();
      
      const unsigned = {
        kind: 30002,
        created_at: 1234567890,
        tags: [],
        content: '',
      };

      await expect(signEvent(unsigned)).rejects.toThrow('No pubkey available');
    });
  });

  describe('getCurrentPubkey', () => {
    it('should return current pubkey from store', () => {
      vi.mocked(get).mockReturnValue('test-pubkey-123');

      const result = getCurrentPubkey();

      expect(result).toBe('test-pubkey-123');
    });

    it('should return null when no pubkey is set', () => {
      vi.mocked(get).mockReturnValue(undefined);

      const result = getCurrentPubkey();

      expect(result).toBeNull();
    });
  });
});
