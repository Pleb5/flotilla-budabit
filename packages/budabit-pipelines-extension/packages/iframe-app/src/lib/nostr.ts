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

/**
 * Worker discovery stream — kind 10100 worker advertisements. Untrusted by
 * design: any pubkey can advertise itself as a worker, the UI ranks/filters
 * downstream. Filters to events from the last 5 minutes via `since` so we
 * never even see ads from workers that haven't republished recently.
 */
export const WORKER_ONLINE_WINDOW_MS = 5 * 60 * 1000;

export function buildWorkerEvents(relays: string[]): Observable<NostrEvent> {
  const since = Math.floor((Date.now() - WORKER_ONLINE_WINDOW_MS) / 1000);
  return pool
    .subscription(relays, {kinds: [KIND_LOOM_WORKER], since})
    .pipe(onlyEvents());
}

/**
 * Layered event stream for the Releases tab. Mirrors `buildRepoEvents` but
 * keyed on `repoNaddr` (the address pointer), with trust scoped to the
 * provided maintainer set, and a configurable artifact-kind filter.
 *
 * Layers:
 * - **Workflow runs (5401)** scoped by `#a: repoNaddr`, filtered to runs
 *   triggered by trusted maintainers.
 * - **Artifacts (filterKinds)** via two parallel paths: by `authors:
 *   publishers` and by `#e: runIds`. Downstream code dedupes.
 * - **Loom jobs (5100)** by `#e: runIds`, used to derive worker pubkeys.
 * - **Worker ads (10100)** by `authors: workerPubkeys`, used to resolve
 *   worker names.
 */
export function buildReleaseEvents(args: {
  repoNaddr: string;
  trustedMaintainers: string[];
  relays: string[];
  filterKinds: number[];
}): Observable<NostrEvent> {
  const {repoNaddr, trustedMaintainers, relays, filterKinds} = args;
  const trusted = new Set(trustedMaintainers);
  if (trusted.size === 0) return EMPTY;

  const accumulateToSet = <T>(values$: Observable<T>) =>
    values$.pipe(
      scan((set, v) => (set.has(v) ? set : new Set(set).add(v)), new Set<T>()),
      distinctUntilChanged(setsEqual),
    );

  const trustedRuns$ = pool
    .subscription(relays, {
      kinds: [KIND_WORKFLOW_RUN],
      '#a': [repoNaddr],
    })
    .pipe(
      onlyEvents(),
      filter(e => {
        const triggeredBy = eventTagValue(e, 'triggered-by');
        return !!triggeredBy && trusted.has(triggeredBy);
      }),
      shareReplay({bufferSize: Infinity, refCount: true}),
    );

  const publishers$ = accumulateToSet(
    trustedRuns$.pipe(
      map(e => eventTagValue(e, 'publisher')),
      filter((pk): pk is string => !!pk),
    ),
  );

  const runIds$ = accumulateToSet(trustedRuns$.pipe(map(e => e.id)));

  const artifactsByPublisher$ = publishers$.pipe(
    switchMap(pubs => {
      if (!pubs.size) return EMPTY;
      return pool
        .subscription(relays, {kinds: filterKinds, authors: [...pubs]})
        .pipe(onlyEvents());
    }),
  );

  const artifactsByRun$ = runIds$.pipe(
    switchMap(ids => {
      if (!ids.size) return EMPTY;
      return pool
        .subscription(relays, {kinds: filterKinds, '#e': [...ids]})
        .pipe(onlyEvents());
    }),
  );

  const loomJobs$ = runIds$.pipe(
    switchMap(ids => {
      if (!ids.size) return EMPTY;
      return pool
        .subscription(relays, {kinds: [KIND_LOOM_JOB], '#e': [...ids]})
        .pipe(onlyEvents());
    }),
    shareReplay({bufferSize: Infinity, refCount: true}),
  );

  const workerPubkeys$ = accumulateToSet(
    loomJobs$.pipe(
      map(e => eventTagValue(e, 'p')),
      filter((pk): pk is string => !!pk),
    ),
  );

  const workerAds$ = workerPubkeys$.pipe(
    switchMap(pks => {
      if (!pks.size) return EMPTY;
      return pool
        .subscription(relays, {kinds: [KIND_LOOM_WORKER], authors: [...pks]})
        .pipe(onlyEvents());
    }),
  );

  return merge(trustedRuns$, artifactsByPublisher$, artifactsByRun$, loomJobs$, workerAds$);
}
