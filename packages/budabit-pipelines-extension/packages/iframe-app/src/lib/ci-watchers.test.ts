import {describe, expect, it, vi} from 'vitest';
import {ciWatcherChoices, FALLBACK_CI_WATCHER, selectCiWatcher} from './ci-watchers';
import {createCiWatchSession, type CiWatchState} from './ci-watch-session';
import {bridgeNostrSigner} from './ci-watch';
import {normalizeRepo, transformHostContext} from './context';
import type {RepoCiWatcher, WidgetBridge} from 'budabit-sdk';

const watcher: RepoCiWatcher = {pubkey: 'a'.repeat(64), relays: ['wss://ci.example'], communityAddress: '32222:test:test', communityName: 'BudaBit', role: 'member', repoMatch: true};
const address = `30617:${'b'.repeat(64)}:repo`;
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
function client() {
  return {ListFollowed: vi.fn().mockResolvedValue([]), FollowRepo: vi.fn().mockResolvedValue({}), UnfollowRepo: vi.fn().mockResolvedValue({}), disconnect: vi.fn().mockResolvedValue(undefined)};
}

describe('watcher selection and context', () => {
  it('always has one fallback, while eligible community order supplies the default', () => {
    expect(selectCiWatcher(ciWatcherChoices()).pubkey).toBe(FALLBACK_CI_WATCHER.pubkey);
    expect(selectCiWatcher(ciWatcherChoices([watcher])).pubkey).toBe(watcher.pubkey);
    expect(ciWatcherChoices([{...watcher, pubkey: FALLBACK_CI_WATCHER.pubkey}])).toHaveLength(1);
  });
  it('keeps a manual selection through hydration, but replaces removed choices', () => {
    const choices = ciWatcherChoices([watcher]);
    expect(selectCiWatcher(choices, FALLBACK_CI_WATCHER.pubkey).pubkey).toBe(FALLBACK_CI_WATCHER.pubkey);
    expect(selectCiWatcher(ciWatcherChoices(), watcher.pubkey).pubkey).toBe(FALLBACK_CI_WATCHER.pubkey);
    expect(selectCiWatcher(choices, null).pubkey).toBe(watcher.pubkey);
  });
  it('preserves choices and account across init, full update, repo update and getRepo shapes', () => {
    const flat = {pubkey: 'b'.repeat(64), name: 'repo', address, userPubkey: 'c'.repeat(64), ciWatchers: [watcher]};
    for (const input of [flat, {userPubkey: flat.userPubkey, repo: flat}, {repoPubkey: flat.pubkey, repoName: flat.name, repoAddress: address, userPubkey: flat.userPubkey, ciWatchers: [watcher]}]) {
      expect(normalizeRepo(transformHostContext(input))).toMatchObject({ciWatchers: [watcher], userPubkey: flat.userPubkey, repoAddress: address});
    }
  });
});

describe('watcher session boundaries', () => {
  it('queries and mutates only its selected client and repo, serializing double clicks', async () => {
    const c = client(); const action = deferred(); c.FollowRepo.mockReturnValue(action.promise);
    const states: CiWatchState[] = [];
    const session = createCiWatchSession(c, address, ['wss://repo.example'], s => states.push(s));
    await Promise.resolve();
    const first = session.toggle(); await session.toggle();
    expect(c.FollowRepo).toHaveBeenCalledExactlyOnceWith(address, undefined, undefined, ['wss://repo.example']);
    action.resolve({}); await first;
    expect(states.at(-1)?.status).toBe('followed');
    await session.toggle();
    expect(c.UnfollowRepo).toHaveBeenCalledExactlyOnceWith(address, undefined, undefined, ['wss://repo.example']);
    session.dispose();
  });
  it('ignores late follow-status and action responses after switching watcher/account/repo', async () => {
    const c = client(); const query = deferred(); c.ListFollowed.mockReturnValue(query.promise);
    const update = vi.fn(); const session = createCiWatchSession(c, address, [], update);
    session.dispose(); query.resolve([address]); await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    await session.toggle(); expect(c.FollowRepo).not.toHaveBeenCalled();
    const c2 = client(); const action = deferred(); c2.FollowRepo.mockReturnValue(action.promise);
    const update2 = vi.fn(); const session2 = createCiWatchSession(c2, address, [], update2);
    await Promise.resolve(); const pending = session2.toggle();
    const count = update2.mock.calls.length;
    session2.dispose(); action.resolve({}); await pending;
    expect(update2).toHaveBeenCalledTimes(count);
    expect(c2.disconnect).toHaveBeenCalledOnce();
  });
  it('surfaces denied and unreachable watcher states without claiming success', async () => {
    for (const [message, status] of [['unauthorized', 'unauthorized'], ['offline', 'error']]) {
      const c = client(); c.ListFollowed.mockRejectedValue(new Error(message));
      const update = vi.fn(); const session = createCiWatchSession(c, address, [], update);
      await Promise.resolve();
      expect(update).toHaveBeenLastCalledWith({status, busy: false, error: message});
      session.dispose();
    }
  });
  it('does not finish signing or initiate encryption for an invalidated account context', async () => {
    const pending = deferred(); const request = vi.fn().mockReturnValue(pending.promise);
    let active = true;
    const signer = bridgeNostrSigner({request} as unknown as WidgetBridge, 'a'.repeat(64), () => active);
    const signing = signer.signEvent({kind: 25910, created_at: 1, tags: [], content: ''});
    active = false; pending.resolve({id: 'test', sig: 'test'});
    await expect(signing).rejects.toThrow('Watcher context changed');
    await expect(signer.nip44!.encrypt('b'.repeat(64), 'hello')).rejects.toThrow('Watcher context changed');
    expect(request).toHaveBeenCalledOnce();
  });
});
