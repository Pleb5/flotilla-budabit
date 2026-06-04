import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { parseRepoId } from '../../src/utils/repo-id.js';

describe('utils/parseRepoId', () => {
  it('accepts owner/name and normalizes segments', () => {
    expect(parseRepoId('Owner/Repo')).toBe('Owner/Repo');
    expect(parseRepoId('own er/re po')).toBe('own-er/re-po');
    expect(parseRepoId('own/er/repo')).toBe('own/er'); // split only first ':' or '/'
  });

  it('accepts owner:name and converts to slash', () => {
    expect(parseRepoId('owner:repo')).toBe('owner/repo');
    expect(parseRepoId('own er:re po')).toBe('own-er/re-po');
  });

  it('rejects empty and malformed', () => {
    expect(() => parseRepoId('')).toThrow(/Invalid repoId/);
    expect(() => parseRepoId('owner/')).toThrow(/both parts present/);
    expect(() => parseRepoId('owner:')).toThrow(/both parts present/);
  });

  it('rejects event-id like values', () => {
    const eid = 'a'.repeat(64);
    expect(() => parseRepoId(eid)).toThrow(/event id-like/);
  });
});
