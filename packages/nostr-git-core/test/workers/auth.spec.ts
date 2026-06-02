import { describe, it, expect } from 'vitest';

import { setAuthConfig, getAuthCallback, getConfiguredAuthHosts, getTokensForHost, tryPushWithTokens } from '../../src/worker/workers/auth.js';

describe('worker/auth utilities', () => {
  it('getAuthCallback returns undefined with no config or bad URL', () => {
    setAuthConfig({ tokens: [] });
    expect(getAuthCallback('https://example.com/repo.git')).toBeUndefined();
    // invalid URL string
    expect(getAuthCallback('not a url')).toBeUndefined();
  });

  it('getTokensForHost returns empty when no tokens configured', async () => {
    setAuthConfig({ tokens: [] });
    const res = await getTokensForHost('EXAMPLE.com');
    expect(res).toEqual([]);
  });

  it('getAuthCallback matches exact host and subdomain', () => {
    setAuthConfig({ tokens: [{ host: 'example.com', token: 't1' }] });
    const cb1 = getAuthCallback('https://example.com/repo.git');
    const cb2 = getAuthCallback('https://git.example.com/owner/repo.git');
    expect(typeof cb1).toBe('function');
    expect(typeof cb2).toBe('function');
    // ensure callback returns token credentials
    const creds = cb2!();
    expect(creds.username).toBe('token');
    expect(creds.password).toBe('t1');
  });

  it('getConfiguredAuthHosts returns configured hosts even on errors', () => {
    setAuthConfig({ tokens: [{ host: 'a.com', token: 'x' }, { host: 'b.com', token: 'y' }] });
    const hosts = getConfiguredAuthHosts();
    expect(hosts).toEqual(['a.com', 'b.com']);
  });

  it('getTokensForHost matches exact and subdomain variants', async () => {
    setAuthConfig({ tokens: [
      { host: 'example.com', token: 't1' },
      { host: 'api.example.com', token: 't2' },
      { host: 'other.com', token: 't3' },
    ]});
    const exact = await getTokensForHost('example.com');
    expect(exact.map(t => t.token)).toEqual(expect.arrayContaining(['t1']));
    const sub = await getTokensForHost('svc.api.example.com');
    expect(sub.map(t => t.token)).toEqual(expect.arrayContaining(['t2']));
  });

  it('tryPushWithTokens tries tokens and succeeds, then throws aggregated on all-fail', async () => {
    setAuthConfig({ tokens: [
      { host: 'git.example.com', token: 'ok' },
      { host: 'git.example.com', token: 'bad' },
    ]});

    let attempts = 0;
    const url = 'https://git.example.com/owner/repo.git';
    const result = await tryPushWithTokens(url, async (authCb) => {
      attempts += 1;
      const creds = authCb?.();
      if (creds?.password === 'ok') return 'pushed';
      throw new Error('denied');
    });
    expect(result).toBe('pushed');
    expect(attempts).toBe(1);

    // Now set tokens that all fail
    setAuthConfig({ tokens: [
      { host: 'git.example.com', token: 't1' },
      { host: 'git.example.com', token: 't2' },
    ]});
    await expect(tryPushWithTokens(url, async (_auth) => { throw new Error('nope'); }))
      .rejects.toThrow(/All tokens failed/);
  });
});
