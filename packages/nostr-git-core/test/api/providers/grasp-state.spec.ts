import { describe, it, expect } from 'vitest';
import {
  encodeRepoAddress,
  parseRepoAddress,
  getDefaultBranchFromHead,
  isNostrRef,
  getEventIdFromNostrRef,
  createNostrRefName,
  normalizePushTarget
} from '../../../src/api/providers/grasp-state.js';

// Note: nip19 encoding is exercised indirectly; we only assert format structure

describe('grasp-state helpers', () => {
  it('encodeRepoAddress returns npub-prefixed address format', () => {
    const addr = encodeRepoAddress('deadbeef'.repeat(8).slice(0, 64), 'repo');
    expect(addr.includes(':repo')).toBe(true);
    expect(addr.startsWith('npub1')).toBe(true);
  });

  it('parseRepoAddress splits npub and repo', () => {
    const parsed = parseRepoAddress('npub1xyz:myrepo');
    expect(parsed.npub).toBe('npub1xyz');
    expect(parsed.repo).toBe('myrepo');
  });

  it('getDefaultBranchFromHead extracts branch from refs/heads', () => {
    expect(getDefaultBranchFromHead('refs/heads/main')).toBe('main');
    expect(getDefaultBranchFromHead('HEAD')).toBe('main'); // fallback
  });

  it('nostr ref helpers map correctly', () => {
    const ref = createNostrRefName('abc');
    expect(ref).toBe('refs/nostr/abc');
    expect(isNostrRef(ref)).toBe(true);
    expect(getEventIdFromNostrRef(ref)).toBe('abc');
    expect(isNostrRef('refs/heads/main')).toBe(false);
  });

  it('normalizePushTarget handles nostr/ prefix and pass-throughs', () => {
    expect(normalizePushTarget('nostr/abc')).toBe('refs/nostr/abc');
    expect(normalizePushTarget('refs/nostr/abc')).toBe('refs/nostr/abc');
    expect(normalizePushTarget('refs/heads/main')).toBe('refs/heads/main');
  });
});
