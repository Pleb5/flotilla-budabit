import type { NostrEvent, WidgetBridge } from 'budabit-sdk';
import { record, type RepoContext } from './context.js';
import {
  authorizedApplication,
  authorizedRelease,
  coordinate,
  replacements,
  verifiedEvent,
} from './trust.js';
import { getRelays, parseApplication } from './releases.js';
import { queryAll } from './query.js';
import type { SoftwareApplication } from './types.js';

export interface ListState {
  apps: SoftwareApplication[];
  events: NostrEvent[];
  loading: boolean;
  partial: boolean;
  error: string;
}
const CACHE_KEY = 'verified-releases-v2';
const MAX_EVENTS = 1000;

export function startReleaseList(
  bridge: WidgetBridge,
  repo: RepoContext,
  onState: (state: ListState) => void,
  onCleanupError: (error: unknown) => void = console.warn
) {
  const controller = new AbortController();
  const aborted = () => controller.signal.aborted;
  let disposed = false,
    discovered = false,
    subscription: Awaited<ReturnType<WidgetBridge['subscribe']>> | null = null;
  let hostId: string | null = null;
  let pending: { subscriptionId: string; event: NostrEvent }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let emitTimer: ReturnType<typeof setTimeout> | undefined;
  let partial = false;
  const apps = new Map<string, NostrEvent>(),
    releases = new Map<string, NostrEvent>();
  const liveIds = new Set<string>();
  let error = '';
  function state(): ListState {
    const approved = [...apps.values()]
      .filter((e) => authorizedApplication(e, repo))
      .map(parseApplication);
    return {
      apps: approved,
      events: [...releases.values()]
        .filter((e) => authorizedRelease(e, repo, approved))
        .sort((a, b) => b.created_at - a.created_at),
      loading: !discovered,
      partial,
      error,
    };
  }
  function emit() {
    clearTimeout(emitTimer);
    emitTimer = undefined;
    if (!disposed) onState(state());
  }
  function apply(raw: unknown) {
    const event = verifiedEvent(raw);
    if (!event || !repo.maintainers.includes(event.pubkey) || ![32267, 30063].includes(event.kind))
      return;
    const map = event.kind === 32267 ? apps : releases;
    const key = coordinate(event),
      old = map.get(key);
    const latest = replacements(old ? [old, event] : [event])[0];
    if (latest) map.set(key, latest);
    const oldestKey = map.keys().next().value;
    if (map.size > MAX_EVENTS && oldestKey) {
      map.delete(oldestKey);
      partial = true;
    }
  }
  async function saveCache() {
    if (disposed || !discovered) return;
    try {
      const events: NostrEvent[] = [];
      let bytes = 0;
      for (const event of replacements(releases.values()).slice(0, 100)) {
        bytes += new TextEncoder().encode(JSON.stringify(event)).length;
        if (bytes > 500_000) break;
        events.push(event);
      }
      const response = record(
        await bridge.request('storage:set', {
          key: CACHE_KEY,
          repoScoped: true,
          expectedRepoAddress: repo.repoAddress,
          data: { repoAddress: repo.repoAddress, events, ts: Date.now() },
        })
      );
      if (response.error)
        throw new Error(typeof response.error === 'string' ? response.error : 'Cache write failed');
    } catch (err) {
      onCleanupError(err);
    }
  }
  const off = bridge.onEvent('nostr:subscription:event', (payload) => {
    if (disposed) return;
    if (!hostId) {
      if (pending.length < MAX_EVENTS) pending.push(payload);
      else partial = true;
      return;
    }
    if (payload.subscriptionId !== hostId) return;
    if (!discovered && liveIds.size < MAX_EVENTS) liveIds.add(payload.event.id);
    apply(payload.event);
    // Coalesce relay backfill across message tasks, not just within one callback.
    emitTimer ??= setTimeout(emit, 16);
    clearTimeout(timer);
    timer = setTimeout(() => void saveCache(), 500);
  });
  async function closeSubscription() {
    const sub = subscription;
    subscription = null;
    if (!sub) return;
    try {
      const response = record(await sub.unsubscribe());
      if (response.error)
        throw new Error(
          typeof response.error === 'string' ? response.error : 'Subscription cleanup failed'
        );
    } catch (err) {
      onCleanupError(err);
    }
  }
  const ready = (async () => {
    emit();
    try {
      // Cached releases never establish application authority; discover apps live first.
      try {
        const cached = record(
          record(
            await bridge.request('storage:get', {
              key: CACHE_KEY,
              repoScoped: true,
              expectedRepoAddress: repo.repoAddress,
            })
          ).data
        );
        if (aborted()) return;
        if (
          cached.repoAddress === repo.repoAddress &&
          typeof cached.ts === 'number' &&
          cached.ts <= Date.now() &&
          Date.now() - cached.ts < 86400_000 &&
          Array.isArray(cached.events)
        ) {
          for (const event of cached.events.slice(0, 100))
            if (record(event).kind === 30063) apply(event);
        }
      } catch {
        /* optional cache */
      }
      if (aborted()) return;
      subscription = await bridge.subscribe({
        relays: getRelays(repo.repoRelays),
        filter: { kinds: [32267, 30063], authors: [...repo.maintainers] },
      });
      if (aborted()) {
        await closeSubscription();
        return;
      }
      hostId = subscription.subscriptionId;
      for (const item of pending)
        if (item.subscriptionId === hostId) {
          liveIds.add(item.event.id);
          apply(item.event);
        }
      pending = [];
      const result = await queryAll(
        bridge,
        getRelays(repo.repoRelays),
        { kinds: [32267, 30063], authors: [...repo.maintainers] },
        controller.signal
      );
      if (aborted()) return;
      if (result.complete) {
        const ids = new Set(result.events.map((e) => e.id));
        for (const [key, event] of releases)
          if (!ids.has(event.id) && !liveIds.has(event.id)) releases.delete(key);
      }
      for (const event of result.events) apply(event);
      liveIds.clear();
      error = result.errors?.join('; ') ?? '';
      partial ||= !result.complete;
      discovered = true;
      emit();
      await saveCache();
    } catch (err) {
      if (aborted()) return;
      error = err instanceof Error ? err.message : String(err);
      discovered = true;
      partial = true;
      emit();
    }
  })();
  return {
    ready,
    async dispose() {
      disposed = true;
      controller.abort();
      off();
      clearTimeout(timer);
      clearTimeout(emitTimer);
      pending = [];
      await closeSubscription();
      await ready;
      await closeSubscription();
    },
  };
}
