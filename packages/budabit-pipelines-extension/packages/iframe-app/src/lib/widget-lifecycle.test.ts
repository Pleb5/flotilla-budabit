import {afterEach, describe, expect, it, vi} from 'vitest';
import {setupWidgetLifecycle} from './widget-lifecycle';

const {listeners, bridge} = vi.hoisted(() => {
  const listeners = new Map<string, (payload: unknown) => void>();
  return {listeners, bridge: {
    onEvent: vi.fn((action: string, callback: (payload: unknown) => void) => {
      listeners.set(action, callback);
      return () => listeners.delete(action);
    }),
    signalReady: vi.fn(), destroy: vi.fn(), request: vi.fn(),
  }};
});
vi.mock('budabit-sdk', () => ({createWidgetBridge: () => bridge}));
vi.mock('../host-theme', () => ({watchHostTheme: () => () => undefined}));
afterEach(() => {listeners.clear(); vi.useRealTimers();});

describe('watcher hydration in repo lifecycle', () => {
  it('updates watcher metadata without resetting run state; resets once on account/repo changes', () => {
    vi.useFakeTimers();
    const onRepoChange = vi.fn();
    const onRepoContextChange = vi.fn();
    const dispose = setupWidgetLifecycle({onBridgeChange: vi.fn(), onRepoContextChange, onRepoChange, onUnmount: vi.fn()});
    const repo = {repoPubkey: 'a'.repeat(64), repoName: 'repo', userPubkey: 'b'.repeat(64), ciWatchers: []};
    listeners.get('widget:init')!({repoContext: repo});
    listeners.get('context:update')!({userPubkey: repo.userPubkey, repo});
    listeners.get('context:repoUpdate')!(repo);
    expect(onRepoChange).not.toHaveBeenCalled();
    const hydrated = {...repo, ciWatchers: [{pubkey: 'c'.repeat(64)}]};
    listeners.get('context:repoUpdate')!(hydrated);
    expect(onRepoContextChange).toHaveBeenLastCalledWith(expect.objectContaining({repo: expect.objectContaining({ciWatchers: hydrated.ciWatchers})}));
    expect(onRepoChange).not.toHaveBeenCalled();
    const next = {...repo, userPubkey: 'd'.repeat(64)};
    listeners.get('context:update')!({userPubkey: next.userPubkey, repo: next});
    listeners.get('context:repoUpdate')!(next);
    expect(onRepoChange).toHaveBeenCalledTimes(1);
    listeners.get('context:repoUpdate')!({...next, repoName: 'other'});
    expect(onRepoChange).toHaveBeenCalledTimes(2);
    dispose();
  });
});
