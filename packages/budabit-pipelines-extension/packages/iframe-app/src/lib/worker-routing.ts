import {catchError, lastValueFrom, of, reduce, takeUntil, timer} from 'rxjs'
import {verifyEvent, type Event as NostrEvent} from 'nostr-tools'
import {eventStore, pool, LOOM_WORKER_RELAYS, PROFILE_LOOKUP_RELAYS} from './nostr'

export const WORKER_RELAY_LOOKUP_MS = 3000

export function normalizeRelayUrls(relays: readonly string[]): string[] {
  const result = new Set<string>()
  for (const relay of relays) {
    try {
      const url = new URL(relay)
      if (!['wss:', 'ws:'].includes(url.protocol) || url.username || url.password) continue
      url.hash = ''
      result.add(url.toString().replace(/\/$/, ''))
    } catch { /* Ignore malformed relay hints. */ }
  }
  return [...result]
}

/** Deliver to the selected worker's NIP-65 inboxes, with Loom defaults for older ads. */
export async function resolveWorkerDeliveryRelays(worker: string, repoRelays: string[]): Promise<string[]> {
  const fallback = normalizeRelayUrls([...repoRelays, ...LOOM_WORKER_RELAYS])
  const cached = eventStore.getReplaceable(10002, worker)
  const isWorkerList = (event: NostrEvent) =>
    event.kind === 10002 && event.pubkey === worker && verifyEvent(event)
  const initial = cached && isWorkerList(cached) ? cached : null
  // Bound the whole lookup, not each emission. A dead relay must not block a job,
  // nor discard a valid list received from another relay before the deadline.
  const newest = await lastValueFrom(pool.request(
    normalizeRelayUrls([...PROFILE_LOOKUP_RELAYS, ...fallback]),
    {kinds: [10002], authors: [worker]},
  ).pipe(
    takeUntil(timer(WORKER_RELAY_LOOKUP_MS)),
    catchError(() => of()),
    reduce<NostrEvent, NostrEvent | null>((latest, event) =>
      isWorkerList(event) && (!latest || event.created_at > latest.created_at ||
        (event.created_at === latest.created_at && event.id < latest.id)) ? event : latest, initial),
  ))
  if (newest) eventStore.add(newest)
  const inboxes = newest?.tags
    .filter(tag => tag[0] === 'r' && (!tag[2] || tag[2] === 'read'))
    .map(tag => tag[1]!) ?? []
  return normalizeRelayUrls([...inboxes, ...fallback])
}
