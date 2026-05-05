import {EventStore} from 'applesauce-core';
import {RelayPool, onlyEvents} from 'applesauce-relay';
import {createEventLoaderForStore} from 'applesauce-loaders/loaders';
import {
  EMPTY,
  combineLatest,
  distinctUntilChanged,
  filter,
  map,
  merge,
  scan,
  shareReplay,
  switchMap,
  type Observable,
} from 'rxjs';
import type {NostrEvent} from './types';
import {
  KIND_LOOM_JOB,
  KIND_LOOM_RESULT,
  KIND_LOOM_STATUS,
  KIND_LOOM_WORKER,
  KIND_WORKFLOW_RESULT,
  KIND_WORKFLOW_RUN,
  eventTagValue,
} from './workflows';

/**
 * Shared nostr primitives for the widget.
 *
 * Phase 1: in-memory EventStore. Phase 1b will swap in a Turso-WASM
 * persistent database so cold loads are instant across sessions.
 */

export const eventStore = new EventStore();
export const pool = new RelayPool();

/** Well-known relays that index profile/metadata events for everyone. */
const PROFILE_LOOKUP_RELAYS = ['wss://purplepag.es', 'wss://index.hzrd149.com'];

/**
 * Populate `eventStore.eventLoader` so `eventStore.model(ProfileModel, pubkey)`
 * (and any other id/address lookups) will lazily fetch missing events from
 * relays and stream them back into the store.
 */
eventStore.eventLoader = createEventLoaderForStore(eventStore, pool, {
  lookupRelays: PROFILE_LOOKUP_RELAYS,
  bufferTime: 250,
});

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Layered event stream for a repo's pipelines view.
 *
 * Untrusted identities can't spam us with bogus status/result events — every
 * secondary subscription is keyed on pubkeys or ids that have already appeared
 * in a trust-gated upstream event.
 *
 * Subscription layers (each is its own `pool.subscription` so a single relay
 * can fail to index one kind without taking the rest down with it):
 *
 * - **Workflow runs (5401)**: scoped by repo `#a` and authored by maintainers.
 *   Anchors everything else.
 * - **Loom jobs (5100)**: scoped by `#e: [...runIds]` once a workflow run is
 *   seen. Many relays don't index 5100 by `#a` (NIP-90 5xxx range is often
 *   treated as ephemeral or differently indexed), so fetching them by their
 *   parent run reference is the reliable path.
 * - **Worker layer (5101 / 30100)**: keyed on worker pubkeys + loom job ids
 *   from layer-2.
 * - **Worker profile (10100)**: keyed on worker pubkeys.
 * - **Publisher layer (5402)**: keyed on publisher pubkeys + run ids from
 *   layer-1.
 */
export function buildRepoEvents(
  repoAddress: string,
  relays: string[],
  trustedAuthors: string[],
): Observable<NostrEvent> {
  const authors = [...new Set(trustedAuthors)];
  if (authors.length === 0) return EMPTY;

  const workflowRuns$ = pool
    .subscription(relays, {
      kinds: [KIND_WORKFLOW_RUN],
      '#a': [repoAddress],
      authors,
    })
    .pipe(onlyEvents(), shareReplay({bufferSize: Infinity, refCount: true}));

  const accumulateToSet = <T>(values$: Observable<T>) =>
    values$.pipe(
      scan((set, v) => (set.has(v) ? set : new Set(set).add(v)), new Set<T>()),
      distinctUntilChanged(setsEqual),
    );

  const publishers$ = accumulateToSet(
    workflowRuns$.pipe(
      map(e => eventTagValue(e, 'publisher')),
      filter((pk): pk is string => !!pk),
    ),
  );

  const runIds$ = accumulateToSet(workflowRuns$.pipe(map(e => e.id)));

  const loomJobs$: Observable<NostrEvent> = runIds$.pipe(
    switchMap(runIds => {
      if (!runIds.size) return EMPTY;
      return pool
        .subscription(relays, {
          kinds: [KIND_LOOM_JOB],
          '#e': [...runIds],
        })
        .pipe(onlyEvents());
    }),
    shareReplay({bufferSize: Infinity, refCount: true}),
  );

  const workers$ = accumulateToSet(
    loomJobs$.pipe(
      map(e => eventTagValue(e, 'p')),
      filter((pk): pk is string => !!pk),
    ),
  );

  const jobIds$ = accumulateToSet(loomJobs$.pipe(map(e => e.id)));

  const workerEvents$ = combineLatest([workers$, jobIds$]).pipe(
    switchMap(([workers, jobIds]) => {
      if (!workers.size || !jobIds.size) return EMPTY;
      return pool
        .subscription(relays, {
          kinds: [KIND_LOOM_RESULT, KIND_LOOM_STATUS],
          authors: [...workers],
          '#e': [...jobIds],
        })
        .pipe(onlyEvents());
    }),
  );

  const workerInfo$ = workers$.pipe(
    switchMap(workers => {
      if (!workers.size) return EMPTY;
      return pool
        .subscription(relays, {
          kinds: [KIND_LOOM_WORKER],
          authors: [...workers],
        })
        .pipe(onlyEvents());
    }),
  );

  const workflowResults$ = combineLatest([publishers$, runIds$]).pipe(
    switchMap(([publishers, runIds]) => {
      if (!publishers.size || !runIds.size) return EMPTY;
      return pool
        .subscription(relays, {
          kinds: [KIND_WORKFLOW_RESULT],
          authors: [...publishers],
          '#e': [...runIds],
        })
        .pipe(onlyEvents());
    }),
  );

  return merge(workflowRuns$, loomJobs$, workerEvents$, workerInfo$, workflowResults$);
}
