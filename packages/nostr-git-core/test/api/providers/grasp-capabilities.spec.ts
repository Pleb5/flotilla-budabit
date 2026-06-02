import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeWsOrigin,
  normalizeHttpOrigin,
  deriveHttpOrigins,
  graspCapabilities,
  fetchRelayInfo,
  type RelayInfo
} from '../../../src/api/providers/grasp-capabilities.js';

const origFetch = globalThis.fetch;

describe('grasp-capabilities helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = origFetch as any;
  });

  it('normalizeWsOrigin converts http(s) to ws(s)', () => {
    expect(normalizeWsOrigin('http://relay.example.com/anything')).toBe('ws://relay.example.com');
    expect(normalizeWsOrigin('https://relay.example.com/path')).toBe('wss://relay.example.com');
    expect(normalizeWsOrigin('wss://relay.example.com/foo')).toBe('wss://relay.example.com');
  });

  it('normalizeHttpOrigin converts ws(s) to http(s)', () => {
    expect(normalizeHttpOrigin('ws://relay.example.com/anything')).toBe('http://relay.example.com');
    expect(normalizeHttpOrigin('wss://relay.example.com/path')).toBe('https://relay.example.com');
    expect(normalizeHttpOrigin('https://relay.example.com/foo')).toBe('https://relay.example.com');
  });

  it('deriveHttpOrigins includes primary origin and /git heuristic without duplicates', () => {
    const info: RelayInfo = { http: 'https://relay.example.com', smart_http: ['https://relay.example.com/git'] } as any;
    const list = deriveHttpOrigins('wss://relay.example.com', info);
    expect(list).toContain('https://relay.example.com');
    expect(list).toContain('https://relay.example.com/git');
    // de-dup
    const uniq = new Set(list);
    expect(uniq.size).toBe(list.length);
  });

  it('deriveHttpOrigins works when fields missing and uses fallback + /git', () => {
    const list = deriveHttpOrigins('wss://relay2.example.com');
    expect(list[0]).toBe('https://relay2.example.com');
    expect(list).toContain('https://relay2.example.com/git');
  });

  it('deriveHttpOrigins handles array + string and dedupes odd URLs', () => {
    const info: RelayInfo = {
      http: ['https://relay.example.com', 'https://relay.example.com/'],
      smart_http: 'https://relay.example.com/git'
    } as any;
    const list = deriveHttpOrigins('wss://relay.example.com/', info);
    // should normalize duplicates and include /git
    expect(list.filter((x) => x === 'https://relay.example.com').length).toBe(1);
    expect(list).toContain('https://relay.example.com/git');
  });

  it('graspCapabilities inspects supported_grasps and derives origins', () => {
    const info: RelayInfo = { supported_grasps: ['GRASP-01'], http: 'https://relay.example.com' } as any;
    const caps = graspCapabilities(info, 'wss://relay.example.com');
    expect(caps.grasp01).toBe(true);
    expect(caps.grasp05).toBe(false);
    expect(caps.httpOrigins.length).toBeGreaterThan(0);
    expect(caps.nostrRelays[0]).toBe('wss://relay.example.com');
  });

  it('fetchRelayInfo returns empty object on fetch error and parses on success', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('boom')) as any;
    const empty = await fetchRelayInfo('wss://relay.example.com');
    expect(empty).toEqual({});

    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'relay', supported_grasps: ['GRASP-01'] }) }) as any;
    const ok = await fetchRelayInfo('wss://relay.example.com');
    expect(ok.name).toBe('relay');
  });
});
