import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { sshToHttps } from '../../src/git/git.js';

describe('sshToHttps', () => {
  it('converts scp-like git@host:owner/repo.git to https', () => {
    expect(sshToHttps('git@github.com:owner/repo.git')).toBe('https://github.com/owner/repo.git');
    expect(sshToHttps('git@gitlab.com:group/sub/repo.git')).toBe('https://gitlab.com/group/sub/repo.git');
  });

  it('converts ssh://git@host/owner/repo.git to https (currently returns null as unsupported)', () => {
    // current implementation handles only scp-like form; ensure non-matching returns null
    expect(sshToHttps('ssh://git@github.com/owner/repo.git')).toBeNull();
  });

  it('returns null for already https (no change path)', () => {
    const url = 'https://github.com/owner/repo.git';
    expect(sshToHttps(url)).toBeNull();
  });
});
