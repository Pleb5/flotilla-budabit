import { describe, it, expect } from 'vitest';
import { normalizeRelayUrl, sanitizeRelays } from '../../src/utils/sanitize-relays.js';

describe('utils/sanitize-relays', () => {
  it('normalizes protocols, collapses slashes, and removes trailing slash', () => {
    const u1 = normalizeRelayUrl('wss://Relay.EXAMPLE.com/');
    expect(u1).toBe('wss://relay.example.com');

    const u2 = normalizeRelayUrl('ws://relay.example.com//path//sub/');
    expect(u2).toBe('ws://relay.example.com/path/sub');
  });

  it('chooses ws for onion hosts and removes default ports', () => {
    const u1 = normalizeRelayUrl('exampleonionaddress.onion:80');
    expect(u1.startsWith('ws://')).toBe(true);
    expect(u1).toBe('ws://exampleonionaddress.onion');

    const u2 = normalizeRelayUrl('wss://relay.example.com:443');
    expect(u2).toBe('wss://relay.example.com');

    const u3 = normalizeRelayUrl('ws://relay.example.com:80');
    expect(u3).toBe('ws://relay.example.com');
  });

  it('preserves userinfo and query, lowercases host, and does not drop unauthenticated variants', () => {
    const list = sanitizeRelays([
      'WSS://user:pass@Relay.Example.Com:443/ws?x=1',
      'wss://relay.example.com/ws?x=1',
      'not-a-url',
      'http://relay.example.com',
      'wss://invalid-no-dot',
    ]);

    // Must include the authenticated endpoint with preserved userinfo
    expect(list).toContain('wss://user:pass@relay.example.com/ws?x=1');
    // Should not include obviously invalid or disallowed hosts (no dot in hostname)
    expect(list.some((u) => u.includes('invalid-no-dot'))).toBe(false);
    // All entries should be unique
    expect(new Set(list).size).toBe(list.length);
  });

  it('filters invalid and duplicates, supports onion addresses', () => {
    const out = sanitizeRelays([
      'wss://relay.example.com/',
      'wss://relay.example.com',
      'exampleonionaddress.onion',
      'wss://invalid host',
    ]);
    expect(out).toContain('wss://relay.example.com');
    expect(out.find((u) => u.includes('onion'))?.startsWith('ws://')).toBe(true);
    // deduped
    expect(out.filter((u) => u === 'wss://relay.example.com').length).toBe(1);
  });

  it('drops platform and clone URLs instead of coercing them into relays', () => {
    expect(
      sanitizeRelays([
        'https://github.com',
        'https://github.com/Pleb5/flotilla-budabit',
        'https://github.com/Pleb5/flotilla-budabit.git',
        'github.com/Pleb5/flotilla-budabit.git',
        'wss://github.com/Pleb5/flotilla-budabit.git',
        'https://relay.example.com',
      ]),
    ).toEqual(['wss://relay.example.com']);
  });
});
