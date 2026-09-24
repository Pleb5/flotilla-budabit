import { describe, expect, it } from 'vitest';
import { authorizedApplication, authorizedRelease, replacements, verifiedEvent } from './trust.js';
import { appMatchesRepo, loadRepoApps, parseApplication } from './releases.js';
import { signed, releaseFixture, testPubkey, testRepo } from './test-fixtures.js';
import type { WidgetBridge } from 'budabit-sdk';

describe('release authority', () => {
  it('owns immutable verified records without trusting mutable copies or IDs', () => {
    const raw = signed();
    const owned = verifiedEvent(raw)!;
    expect(Object.isFrozen(owned)).toBe(true);
    expect(Object.isFrozen(owned.tags)).toBe(true);
    expect(Object.isFrozen(owned.tags[0])).toBe(true);
    expect(verifiedEvent(owned)).toBe(owned);
    raw.tags[0]![1] = 'tampered';
    expect(owned.tags[0]?.[1]).toBe('app');
    expect(verifiedEvent(raw)).toBeNull();
    expect(verifiedEvent({ ...owned, content: 'forged same ID' })).toBeNull();
    expect(verifiedEvent({ ...owned, tags: ['not an array'] })).toBeNull();
  });
  it('rejects tampered signatures even after prior verification', () => {
    const event = signed();
    expect(verifiedEvent(event)).not.toBeNull();
    event.content = 'tampered';
    expect(verifiedEvent(event)).toBeNull();
  });
  it('requires exact repo link and authorized app signer', () => {
    const repo = testRepo();
    expect(authorizedApplication(signed(), repo)).toBe(true);
    expect(authorizedApplication(signed({}, 2), repo)).toBe(false);
    expect(
      appMatchesRepo(
        { ...parseApplication(signed()), repoAddress: `30617:${repo.repoPubkey}:other` },
        repo
      )
    ).toBe(false);
    expect(
      appMatchesRepo(
        {
          ...parseApplication(signed()),
          repoAddress: undefined,
          name: 'repo',
          repositoryUrl: 'https://evil.example/owner/repo',
        },
        repo
      )
    ).toBe(false);
  });
  it('rejects correctly signed outsider releases and unlinked releases', () => {
    const apps = [parseApplication(signed())];
    expect(authorizedRelease(releaseFixture(), testRepo(), apps)).toBe(true);
    expect(authorizedRelease(releaseFixture({}, 2), testRepo(), apps)).toBe(false);
    expect(
      authorizedRelease(
        releaseFixture({ tags: releaseFixture().tags.filter((t) => t[0] !== 'a') }),
        testRepo(),
        apps
      )
    ).toBe(false);
  });
  it('uses publisher namespaces and deterministic replacement order', () => {
    const a = signed(),
      b = signed({ created_at: 101 }),
      other = signed({}, 2);
    expect(replacements([a, b, other])).toHaveLength(2);
    expect(replacements([a, b])[0]?.id).toBe(b.id);
    const tie = signed({ content: 'same timestamp' });
    expect(replacements([tie, a])[0]?.id).toBe([a.id, tie.id].sort()[0]);
  });
  it('discovery preserves publisher namespaces and propagates errors', async () => {
    const repo = { ...testRepo(), maintainers: [testPubkey(), testPubkey(2)] };
    const bridge = {
      request: async () => ({ status: 'ok', complete: true, events: [signed(), signed({}, 2)] }),
    } as unknown as WidgetBridge;
    expect(await loadRepoApps(bridge, repo)).toHaveLength(2);
    const failed = { request: async () => ({ error: 'offline' }) } as unknown as WidgetBridge;
    await expect(loadRepoApps(failed, repo)).rejects.toThrow('offline');
  });
});
