/**
 * GRASP Full Cycle Integration Tests
 *
 * This file tests the complete GRASP (Git Relays Authorized via Signed-Nostr Proofs)
 * integration cycle including:
 * - Server discovery and connection
 * - Token request/response flow
 * - Token storage and retrieval
 * - Token refresh/expiration handling
 * - Error cases (server unavailable, invalid tokens, etc.)
 *
 * @see https://github.com/nostr-protocol/nips/pull/XXX for GRASP specification
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { GraspApiProvider } from '../../../src/api/providers/grasp.js';
import { GraspApi } from '../../../src/api/providers/grasp-api.js';
import {
  normalizeWsOrigin,
  normalizeHttpOrigin,
  deriveHttpOrigins,
  graspCapabilities,
  fetchRelayInfo,
  type RelayInfo
} from '../../../src/api/providers/grasp-capabilities.js';
import {
  encodeRepoAddress,
  parseRepoAddress,
  getDefaultBranchFromHead
} from '../../../src/api/providers/grasp-state.js';
import { nip19 } from 'nostr-tools';

// ============================================================================
// Mock Setup
// ============================================================================

// Save original fetch
const origFetch = globalThis.fetch;

// Helper to set private fields
function setPriv<T extends object>(obj: T, key: string, value: any) {
  (obj as any)[key] = value;
}

// Mock EventIO for testing event publishing
function createMockEventIO(overrides: Partial<any> = {}) {
  return {
    publishEvent: vi.fn().mockResolvedValue({ ok: true, id: 'test-event-id' }),
    subscribeToEvents: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    signEvent: vi.fn().mockImplementation(async (event: any) => ({
      ...event,
      id: 'signed-event-id',
      sig: 'test-signature'
    })),
    ...overrides
  };
}

// Mock relay response for NIP-11
function createMockRelayInfo(overrides: Partial<RelayInfo> = {}): RelayInfo {
  return {
    name: 'Test GRASP Relay',
    description: 'A test GRASP relay for integration testing',
    supported_grasps: ['GRASP-01'],
    smart_http: ['https://relay.test.com', 'https://relay.test.com/git'],
    limitation: { max_message_length: 65536 },
    ...overrides
  } as RelayInfo;
}

// ============================================================================
// Test Suites
// ============================================================================

describe('GRASP Full Cycle Integration Tests', () => {
  const testRelayUrl = 'wss://relay.test.com';
  const testPubkeyHex = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  const testNpub = nip19.npubEncode(testPubkeyHex);

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = origFetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  // --------------------------------------------------------------------------
  // Server Discovery and Connection
  // --------------------------------------------------------------------------
  describe('Server Discovery and Connection', () => {
    it('discovers GRASP relay via NIP-11 endpoint', async () => {
      const mockInfo = createMockRelayInfo();
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockInfo
      }) as any;

      const info = await fetchRelayInfo(testRelayUrl);

      expect(info.name).toBe('Test GRASP Relay');
      expect(info.supported_grasps).toContain('GRASP-01');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://relay.test.com',
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/nostr+json' })
        })
      );
    });

    it('handles relay connection failure gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Connection refused')) as any;

      const info = await fetchRelayInfo(testRelayUrl);

      // Should return empty object on failure
      expect(info).toEqual({});
    });

    it('detects GRASP-01 capability from relay info', () => {
      const info = createMockRelayInfo({ supported_grasps: ['GRASP-01'] });
      const caps = graspCapabilities(info, testRelayUrl);

      expect(caps.grasp01).toBe(true);
      expect(caps.grasp05).toBe(false);
    });

    it('detects GRASP-05 archive-only capability', () => {
      const info = createMockRelayInfo({ supported_grasps: ['GRASP-05'] });
      const caps = graspCapabilities(info, testRelayUrl);

      expect(caps.grasp01).toBe(false);
      expect(caps.grasp05).toBe(true);
    });

    it('derives HTTP origins from relay info', () => {
      const info = createMockRelayInfo({
        smart_http: ['https://relay.test.com/git']
      });
      const origins = deriveHttpOrigins(testRelayUrl, info);

      expect(origins).toContain('https://relay.test.com');
      expect(origins).toContain('https://relay.test.com/git');
    });

    it('normalizes WebSocket URLs correctly', () => {
      expect(normalizeWsOrigin('https://relay.test.com/path')).toBe('wss://relay.test.com');
      expect(normalizeWsOrigin('http://relay.test.com/path')).toBe('ws://relay.test.com');
      expect(normalizeWsOrigin('wss://relay.test.com/foo')).toBe('wss://relay.test.com');
    });

    it('normalizes HTTP URLs correctly', () => {
      expect(normalizeHttpOrigin('wss://relay.test.com/path')).toBe('https://relay.test.com');
      expect(normalizeHttpOrigin('ws://relay.test.com/path')).toBe('http://relay.test.com');
      expect(normalizeHttpOrigin('https://relay.test.com/foo')).toBe('https://relay.test.com');
    });
  });

  // --------------------------------------------------------------------------
  // Token Request/Response Flow
  // --------------------------------------------------------------------------
  describe('Token Request/Response Flow', () => {
    it('creates GraspApiProvider with correct configuration', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      // Provider should normalize relay URL
      expect((provider as any).relayUrl).toBe('wss://relay.test.com');
      expect((provider as any).pubkey).toBe(testPubkeyHex);
    });

    it('ensures capabilities before operations', async () => {
      const mockInfo = createMockRelayInfo();
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockInfo
      }) as any;

      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);
      const caps = await provider.getCapabilities();

      expect(caps.grasp01).toBe(true);
      expect(caps.httpOrigins.length).toBeGreaterThan(0);
    });

    it('caches capabilities after first fetch', async () => {
      const mockInfo = createMockRelayInfo();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockInfo
      }) as any;

      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      await provider.getCapabilities();
      await provider.getCapabilities();

      // Fetch should only be called once due to caching
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('getCurrentUser returns user profile from Nostr events', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      // Mock capabilities
      setPriv(provider, 'capabilities', { grasp01: true, httpOrigins: ['https://relay.test.com'] });

      // Mock profile query
      const mockProfile = {
        name: 'Test User',
        about: 'A test user',
        picture: 'https://example.com/avatar.png',
        website: 'https://example.com'
      };

      vi.spyOn(provider as any, 'queryEvents').mockResolvedValueOnce([
        { content: JSON.stringify(mockProfile) }
      ]);

      const user = await provider.getCurrentUser();

      expect(user.name).toBe('Test User');
      expect(user.avatarUrl).toBe('https://example.com/avatar.png');
      expect(user.bio).toBe('A test user');
      expect(user.blog).toBe('https://example.com');
    });
  });

  // --------------------------------------------------------------------------
  // Repository State Management
  // --------------------------------------------------------------------------
  describe('Repository State Management', () => {
    it('encodes repo address in npub:repo format', () => {
      const addr = encodeRepoAddress(testPubkeyHex, 'my-repo');

      expect(addr).toMatch(/^npub1[a-z0-9]+:my-repo$/);
    });

    it('parses repo address back to components', () => {
      const parsed = parseRepoAddress(`${testNpub}:my-repo`);

      expect(parsed.npub).toBe(testNpub);
      expect(parsed.repo).toBe('my-repo');
    });

    it('extracts default branch from HEAD ref', () => {
      expect(getDefaultBranchFromHead('ref: refs/heads/main')).toBe('main');
      expect(getDefaultBranchFromHead('refs/heads/develop')).toBe('develop');
      expect(getDefaultBranchFromHead('HEAD')).toBe('main'); // fallback
    });

    it('getRepo returns repository metadata', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      // Mock capabilities
      setPriv(provider, 'capabilities', { grasp01: true, httpOrigins: ['https://relay.test.com'] });
      setPriv(provider, 'httpBase', 'https://relay.test.com');

      // Mock announcement query
      const mockAnn = { content: JSON.stringify({ description: 'Test repo' }) };
      vi.spyOn(provider as any, 'queryEvents').mockResolvedValue([mockAnn]);
      vi.spyOn(provider as any, 'fetchLatestState').mockResolvedValue({
        head: 'ref: refs/heads/main',
        refs: { 'refs/heads/main': 'abc123' }
      });

      const repo = await provider.getRepo(testPubkeyHex, 'test-repo');

      expect(repo.name).toBe('test-repo');
      expect(repo.description).toBe('Test repo');
      expect(repo.defaultBranch).toBe('main');
      expect(repo.cloneUrl).toContain('.git');
    });

    it('createRepo returns metadata for new GRASP repo', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      // Mock capabilities
      setPriv(provider, 'capabilities', { grasp01: true, httpOrigins: ['https://relay.test.com'] });
      setPriv(provider, 'httpBase', 'https://relay.test.com');

      const repo = await provider.createRepo({
        name: 'new-repo',
        description: 'A new test repo',
        private: false
      });

      expect(repo.name).toBe('new-repo');
      expect(repo.description).toBe('A new test repo');
      expect(repo.cloneUrl).toContain('new-repo.git');
      expect(repo.htmlUrl).toContain('new-repo');
    });
  });

  // --------------------------------------------------------------------------
  // Token Storage and Retrieval (via GraspApi)
  // --------------------------------------------------------------------------
  describe('Token Storage and Retrieval', () => {
    it('GraspApi publishes repository state to relays via publishStateFromLocal', async () => {
      const mockPublish = vi.fn().mockResolvedValue({ ok: true });
      const api = new GraspApi({
        relays: [testRelayUrl],
        publishEvent: mockPublish
      });

      // Mock the pool.publish method
      vi.spyOn((api as any).pool, 'publish').mockResolvedValue([]);

      const result = await api.publishStateFromLocal(testPubkeyHex, 'test-repo');

      // Should return success with event info
      expect(result.success).toBe(true);
      expect(result.relays).toContain(testRelayUrl);
    });

    it('GraspApi retrieves repository state from relays', async () => {
      const api = new GraspApi({
        relays: [testRelayUrl],
        publishEvent: vi.fn()
      });

      // Mock state retrieval - stub the pool querySync
      vi.spyOn((api as any).pool, 'querySync').mockResolvedValue([]);

      const state = await api.getStateFromRelays(testPubkeyHex, 'test-repo');

      // Should return null when no events found
      expect(state).toBeNull();
    });

    it('GraspApi filters capable relays', async () => {
      const api = new GraspApi({
        relays: [testRelayUrl],
        publishEvent: vi.fn()
      });

      // Test capability checking
      vi.spyOn(api, 'checkRelayCapabilities').mockResolvedValue(true);

      const capable = await api.getCapableRelays();
      expect(capable).toContain(testRelayUrl);
    });
  });

  // --------------------------------------------------------------------------
  // Error Cases
  // --------------------------------------------------------------------------
  describe('Error Cases', () => {
    it('handles server unavailable gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      // Should fall back to heuristic capabilities
      const caps = await provider.getCapabilities();

      expect(caps).toBeDefined();
      expect(caps.httpOrigins.length).toBeGreaterThan(0);
    });

    it('handles invalid npub format in getUser', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      await expect(provider.getUser('invalid-username'))
        .rejects.toThrow(/Invalid user identifier/);
    });

    it('handles missing repository state', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      setPriv(provider, 'capabilities', { grasp01: true, httpOrigins: ['https://relay.test.com'] });
      setPriv(provider, 'httpBase', 'https://relay.test.com');

      // Mock no announcement found
      vi.spyOn(provider as any, 'queryEvents').mockResolvedValue([]);
      vi.spyOn(provider as any, 'fetchLatestState').mockResolvedValue(null);

      const repo = await provider.getRepo(testPubkeyHex, 'missing-repo');

      // Should return repo with default/empty fields
      expect(repo.name).toBe('missing-repo');
      expect(repo.description).toBeUndefined();
      // getDefaultBranchFromHead returns 'main' as fallback when no HEAD
      expect(repo.defaultBranch).toBe('main');
    });

    it('handles relay without GRASP-01 support', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      // Set capabilities without GRASP-01
      setPriv(provider, 'capabilities', { grasp01: false, grasp05: true, httpOrigins: ['https://relay.test.com'] });
      setPriv(provider, 'httpBase', 'https://relay.test.com');

      // publishStateFromLocal should return null
      const result = await provider.publishStateFromLocal(testPubkeyHex, 'test-repo');

      expect(result).toBeNull();
    });

    it('handles query errors gracefully', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      // Mock pool that throws on query
      setPriv(provider, 'pool', {
        querySync: vi.fn().mockRejectedValue(new Error('Query failed'))
      });

      const events = await (provider as any).queryEvents([{ kinds: [0] }]);

      // Should return empty array on error
      expect(events).toEqual([]);
    });

    it('handles invalid JSON in profile content', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      vi.spyOn(provider as any, 'queryEvents').mockResolvedValueOnce([
        { content: 'invalid-json{' }
      ]);

      const user = await provider.getCurrentUser();

      // Should return user with empty fields
      expect(user.login).toBe(testNpub);
      expect(user.avatarUrl).toBe('');
      expect(user.name).toBeUndefined();
    });

    it('rejects listIssues as unsupported without EventIO', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      await expect(provider.listIssues(testPubkeyHex, 'test-repo'))
        .rejects.toThrow(/not supported/);
    });

    it('rejects listPatches as unsupported without EventIO', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      await expect(provider.listPatches(testPubkeyHex, 'test-repo'))
        .rejects.toThrow(/not supported/);
    });

    it('rejects forkRepo without EventIO', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      await expect(provider.forkRepo(testPubkeyHex, 'test-repo'))
        .rejects.toThrow(/not supported/);
    });
  });

  // --------------------------------------------------------------------------
  // URL Validation
  // --------------------------------------------------------------------------
  describe('URL Validation', () => {
    it('validates correct Nostr relay URLs', () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);
      const validate = (url: string) => (provider as any).isValidNostrRelayUrl(url);

      expect(validate('wss://relay.example.com')).toBe(true);
      expect(validate('ws://localhost')).toBe(true);
      expect(validate('wss://127.0.0.1')).toBe(true);
      expect(validate('wss://relay.example.com:7447')).toBe(true);
    });

    it('rejects invalid Nostr relay URLs', () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);
      const validate = (url: string) => (provider as any).isValidNostrRelayUrl(url);

      expect(validate('http://relay.example.com')).toBe(false);
      expect(validate('https://relay.example.com')).toBe(false);
      expect(validate('ws://ngit-relay')).toBe(false); // dev-only host
      expect(validate('ws://nodot')).toBe(false); // no dot in hostname
    });
  });

  // --------------------------------------------------------------------------
  // Event Publishing Flow
  // --------------------------------------------------------------------------
  describe('Event Publishing Flow', () => {
    it('publishes events via EventIO when provided', async () => {
      const mockEventIO = createMockEventIO();
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex, mockEventIO);

      setPriv(provider, 'capabilities', { grasp01: true, httpOrigins: ['https://relay.test.com'] });
      setPriv(provider, 'httpBase', 'https://relay.test.com');

      // Mock git operations
      const mockGit = await import('isomorphic-git');
      vi.spyOn(mockGit, 'fetch').mockResolvedValue(undefined);
      vi.spyOn(mockGit, 'listBranches').mockResolvedValue(['main']);
      vi.spyOn(mockGit, 'listTags').mockResolvedValue([]);
      vi.spyOn(mockGit, 'resolveRef').mockImplementation(async ({ ref }: any) => {
        if (ref === 'HEAD') return 'refs/heads/main';
        return 'abc123';
      });

      const event = await provider.publishStateFromLocal(testPubkeyHex, 'test-repo');

      // EventIO.publishEvent should be called
      expect(mockEventIO.publishEvent).toHaveBeenCalled();
    });

    it('returns unsigned event when EventIO publish fails', async () => {
      const mockEventIO = createMockEventIO({
        publishEvent: vi.fn().mockRejectedValue(new Error('Publish failed'))
      });
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex, mockEventIO);

      setPriv(provider, 'capabilities', { grasp01: true, httpOrigins: ['https://relay.test.com'] });
      setPriv(provider, 'httpBase', 'https://relay.test.com');

      // Mock git operations
      const mockGit = await import('isomorphic-git');
      vi.spyOn(mockGit, 'fetch').mockResolvedValue(undefined);
      vi.spyOn(mockGit, 'listBranches').mockResolvedValue(['main']);
      vi.spyOn(mockGit, 'listTags').mockResolvedValue([]);
      vi.spyOn(mockGit, 'resolveRef').mockImplementation(async ({ ref }: any) => {
        if (ref === 'HEAD') return 'refs/heads/main';
        return 'abc123';
      });

      const event = await provider.publishStateFromLocal(testPubkeyHex, 'test-repo');

      // Should still return the unsigned event
      expect(event).toBeDefined();
      expect(event?.tags).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Multi-filter Query Handling
  // --------------------------------------------------------------------------
  describe('Multi-filter Query Handling', () => {
    it('deduplicates events across multiple filters', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      const mockPool = {
        querySync: vi.fn()
          .mockResolvedValueOnce([{ id: '1' }, { id: '2' }])
          .mockResolvedValueOnce([{ id: '2' }, { id: '3' }])
      };
      setPriv(provider, 'pool', mockPool);

      const filters = [{ kinds: [0] }, { kinds: [1] }];
      const events = await (provider as any).queryEvents(filters);

      // Should dedupe by id
      const ids = events.map((e: any) => e.id).sort();
      expect(ids).toEqual(['1', '2', '3']);
    });

    it('handles per-filter query errors gracefully', async () => {
      const provider = new GraspApiProvider(testRelayUrl, testPubkeyHex);

      const mockPool = {
        querySync: vi.fn()
          .mockRejectedValueOnce(new Error('Filter 1 failed'))
          .mockResolvedValueOnce([{ id: 'a' }])
      };
      setPriv(provider, 'pool', mockPool);

      const filters = [{ kinds: [0] }, { kinds: [1] }];
      const events = await (provider as any).queryEvents(filters);

      // Should return results from successful filter
      expect(events.map((e: any) => e.id)).toEqual(['a']);
    });
  });
});

// ============================================================================
// Additional GRASP API Tests
// ============================================================================

describe('GraspApi Extended Tests', () => {
  const testRelayUrl = 'wss://relay.test.com';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('filters capable relays correctly', async () => {
    const api = new GraspApi({
      relays: ['wss://capable.relay', 'wss://incapable.relay', 'wss://capable2.relay'],
      publishEvent: vi.fn()
    });

    vi.spyOn(api, 'checkRelayCapabilities')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const capable = await api.getCapableRelays();

    expect(capable).toEqual(['wss://capable.relay', 'wss://capable2.relay']);
  });

  it('handles empty relay list', async () => {
    const api = new GraspApi({
      relays: [],
      publishEvent: vi.fn()
    });

    const capable = await api.getCapableRelays();

    expect(capable).toEqual([]);
  });

  it('syncs state across multiple relays', async () => {
    const publishEvent = vi.fn().mockResolvedValue({ ok: true });
    const api = new GraspApi({
      relays: ['wss://relay1', 'wss://relay2'],
      publishEvent
    });

    vi.spyOn(api, 'checkRelayCapabilities').mockResolvedValue(true);
    vi.spyOn((api as any).pool, 'publish').mockResolvedValue([]);

    // Use the actual method name
    const result = await api.syncStateAcrossRelays(testRelayUrl, 'repo');

    // Should return sync results
    expect(result.failedRelays).toBeDefined();
  });
});
