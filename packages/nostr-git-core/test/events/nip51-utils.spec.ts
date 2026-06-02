import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { validateGraspServerUrl, normalizeGraspServerUrl, createGraspServersEvent, parseGraspServersEvent } from '../../src/events/nip51/nip51-utils.js';
import { GRASP_SET_KIND } from '../../src/events/nip51/nip51.js';

function mkEvt(content: any): any {
  return { kind: GRASP_SET_KIND, created_at: 1, tags: [['d','default']], content: JSON.stringify(content), pubkey: 'pk' };
}

describe('NIP-51 utils', () => {
  it('validateGraspServerUrl accepts ws(s)/http(s) and rejects others', () => {
    expect(validateGraspServerUrl('ws://example.com')).toBe(true);
    expect(validateGraspServerUrl('wss://example.com')).toBe(true);
    expect(validateGraspServerUrl('http://example.com')).toBe(true);
    expect(validateGraspServerUrl('https://example.com')).toBe(true);
    expect(validateGraspServerUrl('ftp://example.com')).toBe(false);
    expect(validateGraspServerUrl('https://github.com')).toBe(false);
    expect(validateGraspServerUrl('https://github.com/Pleb5/flotilla-budabit.git')).toBe(false);
    expect(validateGraspServerUrl('not a url')).toBe(false);
  });

  it('normalizeGraspServerUrl trims and removes trailing slash', () => {
    expect(normalizeGraspServerUrl(' https://example.com/ ')).toBe('https://example.com');
  });

  it('createGraspServersEvent normalizes, de-dupes and embeds urls in content', () => {
    const evt = createGraspServersEvent({ pubkey: 'pk', urls: ['https://a.com/', 'https://a.com', 'ws://b.com'] });
    expect(evt.kind).toBe(GRASP_SET_KIND);
    const urls = JSON.parse(evt.content).urls as string[];
    expect(urls).toEqual(['https://a.com','ws://b.com']);
    // tag d present
    expect(evt.tags.find((t: any) => t[0] === 'd')).toBeTruthy();
  });

  it('parseGraspServersEvent parses and filters invalid urls', () => {
    const good = mkEvt({ urls: ['https://ok.com/', 'ftp://no.com', 'ws://relay.com', 'https://github.com/Pleb5/repo.git'] });
    expect(parseGraspServersEvent(good as any)).toEqual(['https://ok.com','ws://relay.com']);

    const bad = mkEvt({ urls: 'not-array' });
    expect(parseGraspServersEvent(bad as any)).toEqual([]);

    const malformed = { kind: GRASP_SET_KIND, created_at: 1, tags: [], content: '{', pubkey: 'pk' } as any;
    expect(parseGraspServersEvent(malformed)).toEqual([]);
  });
});
