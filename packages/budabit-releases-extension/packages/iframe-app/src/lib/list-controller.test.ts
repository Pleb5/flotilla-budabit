import { describe, expect, it, vi } from 'vitest';
import type { NostrEvent, WidgetBridge } from 'budabit-sdk';
import { startReleaseList, type ListState } from './list-controller.js';
import { releaseFixture, signed, testRepo } from './test-fixtures.js';
import { verifyEvent } from 'nostr-tools/pure';

vi.mock('nostr-tools/pure', async (original) => {
  const actual = await original<typeof import('nostr-tools/pure')>();
  return { ...actual, verifyEvent: vi.fn(actual.verifyEvent) };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
function host(events: NostrEvent[] = [], cache: unknown = null) {
  let listener: ((value: { subscriptionId: string; event: NostrEvent }) => void) | null = null;
  const off = vi.fn(() => (listener = null));
  const unsubscribe = vi.fn(async () => ({ status: 'ok' }));
  const sub = { subscriptionId: 'host-id', unsubscribe };
  const subscribe = vi.fn(async () => sub);
  const request = vi.fn(async (action: string) =>
    action === 'nostr:query'
      ? { status: 'ok', complete: true, events }
      : { status: 'ok', data: cache }
  );
  const bridge = {
    request,
    subscribe,
    onEvent: (_: string, fn: typeof listener) => {
      listener = fn;
      return off;
    },
  } as unknown as WidgetBridge;
  return {
    bridge,
    request,
    subscribe,
    sub,
    unsubscribe,
    off,
    send: (event: NostrEvent, subscriptionId = 'host-id') => listener?.({ event, subscriptionId }),
  };
}

describe('release list lifecycle and trust', () => {
  it('verifies a substantial backfill once per input and coalesces emissions', async () => {
    const events = Array.from({ length: 250 }, (_, i) =>
      releaseFixture({
        tags: releaseFixture().tags.map((t) =>
          t[0] === 'd' ? ['d', `app@${i}`] : t[0] === 'version' ? ['version', String(i)] : t
        ),
      })
    );
    const h = host([signed()]);
    const onState = vi.fn();
    const session = startReleaseList(h.bridge, testRepo(), onState);
    await session.ready;
    vi.mocked(verifyEvent).mockClear();
    onState.mockClear();
    for (const event of events) h.send(event);
    await vi.waitFor(() => expect(onState).toHaveBeenCalledTimes(1));
    expect(verifyEvent).toHaveBeenCalledTimes(events.length);
    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState.mock.lastCall?.[0].events).toHaveLength(events.length);
    await session.dispose();
  });
  it('does not subscribe or emit after disposal during cache loading', async () => {
    const h = host(),
      cache = deferred<Awaited<ReturnType<typeof h.request>>>();
    h.request.mockImplementationOnce(() => cache.promise);
    const states: ListState[] = [];
    const session = startReleaseList(h.bridge, testRepo(), (next) => states.push(next));
    const closing = session.dispose();
    cache.resolve({ status: 'ok', data: null });
    await closing;
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.off).toHaveBeenCalledTimes(1);
    expect(states).toHaveLength(1);
  });
  it('unsubscribes exactly once when host subscription resolves after disposal', async () => {
    const h = host(),
      pending = deferred<typeof h.sub>();
    h.subscribe.mockImplementationOnce(() => pending.promise);
    const session = startReleaseList(h.bridge, testRepo(), () => {});
    await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalled());
    const closing = session.dispose();
    pending.resolve(h.sub);
    await closing;
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.request.mock.calls.map((c) => c[0])).not.toContain('nostr:query');
  });
  it('filters cached attackers, replaces revisions, and honors application link revocation', async () => {
    const release = releaseFixture(),
      newer = releaseFixture({ created_at: 101 });
    const h = host([signed(), newer], {
      repoAddress: testRepo().repoAddress,
      ts: Date.now(),
      events: [release, releaseFixture({}, 2)],
    });
    let state!: ListState;
    const session = startReleaseList(h.bridge, testRepo(), (next) => (state = next));
    await session.ready;
    expect(state.events.map((e) => e.id)).toEqual([newer.id]);
    h.send(releaseFixture({ created_at: 102 }), 'other-subscription');
    expect(state.events).toHaveLength(1);
    h.send(
      signed({
        created_at: 103,
        tags: [
          ['d', 'app'],
          ['name', 'App'],
        ],
      })
    );
    await vi.waitFor(() => expect(state.apps).toHaveLength(0));
    expect(state.events).toHaveLength(0);
    await session.dispose();
  });
  it('cache alone cannot authorize an app; cleanup errors are reported', async () => {
    const h = host([], {
      repoAddress: testRepo().repoAddress,
      ts: Date.now(),
      apps: [signed()],
      events: [releaseFixture()],
    });
    const errors = vi.fn();
    let state!: ListState;
    h.unsubscribe.mockRejectedValueOnce(new Error('permission denied'));
    const session = startReleaseList(h.bridge, testRepo(), (next) => (state = next), errors);
    await session.ready;
    await session.dispose();
    expect(state.events).toEqual([]);
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ message: 'permission denied' }));
  });
  it('buffers host events before the host-generated ID arrives and marks partial queries', async () => {
    const h = host(),
      pending = deferred<typeof h.sub>();
    h.subscribe.mockImplementationOnce(() => pending.promise);
    h.request.mockImplementation(async (action) =>
      action === 'nostr:query'
        ? { status: 'ok', complete: false, events: [] }
        : { status: 'ok', data: null }
    );
    let state!: ListState;
    const session = startReleaseList(h.bridge, testRepo(), (next) => (state = next));
    await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalled());
    h.send(signed());
    h.send(releaseFixture());
    pending.resolve(h.sub);
    await session.ready;
    expect(state.events).toHaveLength(1);
    expect(state.partial).toBe(true);
    await session.dispose();
  });
});
