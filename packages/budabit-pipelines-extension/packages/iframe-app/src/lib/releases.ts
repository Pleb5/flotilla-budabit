import type { WidgetBridge } from '@flotilla/ext-shared';
import { BehaviorSubject, type Observable } from 'rxjs';
import type { NostrEvent, RepoContextNormalized } from './types';
import { queryEvents, eventTagValue } from './workflows';
import { buildReleaseEvents, eventStore } from './nostr';

const FALLBACK_RELAYS = ['wss://relay.sharegap.net', 'wss://nos.lol'];

function dedupe(values: string[]): string[] {
  return Array.from(
    new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))
  );
}

// ── Types ─────────────────────────────────────────────────────────────

export interface ReleaseArtifact {
  event: NostrEvent;
  hash: string;
  filename: string;
  triggeredBy: string;
  ephemeralPubkey: string;
  workflow: string;
  branch: string;
  tags: Record<string, string>;
}

export interface ArtifactGroup {
  key: string;
  labels: Record<string, string>;
  hashCounts: Map<string, ReleaseArtifact[]>;
  totalCount: number;
  consensusHash: string | null;
  isUnanimous: boolean;
}

export interface LoomWorkerInfo {
  pubkey: string;
  name: string;
}

export type ConsensusStatus = 'unanimous' | 'majority' | 'split';

// ── Validation ────────────────────────────────────────────────────────

export function validateHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash);
}

// ── Grouping & Consensus ──────────────────────────────────────────────

export function buildGroupKey(event: NostrEvent, groupByTags: string[]): string {
  return groupByTags.map((tag) => eventTagValue(event, tag) ?? 'unknown').join('|');
}

export function groupArtifacts(
  artifacts: ReleaseArtifact[],
  groupByTags: string[]
): ArtifactGroup[] {
  const groups = new Map<string, ReleaseArtifact[]>();

  for (const artifact of artifacts) {
    const key = buildGroupKey(artifact.event, groupByTags);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(artifact);
  }

  return Array.from(groups.entries()).map(([key, arts]) => {
    const hashCounts = new Map<string, ReleaseArtifact[]>();
    for (const a of arts) {
      if (!hashCounts.has(a.hash)) hashCounts.set(a.hash, []);
      hashCounts.get(a.hash)!.push(a);
    }

    const sorted = [...hashCounts.entries()].sort((a, b) => b[1].length - a[1].length);
    const consensusHash = sorted[0]?.[0] ?? null;
    const isUnanimous = sorted.length === 1;

    return {
      key,
      labels: Object.fromEntries(
        groupByTags.map((tag) => [tag, arts[0] ? (eventTagValue(arts[0].event, tag) ?? 'unknown') : 'unknown'])
      ),
      hashCounts,
      totalCount: arts.length,
      consensusHash,
      isUnanimous,
    };
  });
}

export function getConsensusStatus(group: ArtifactGroup): ConsensusStatus {
  if (group.isUnanimous) return 'unanimous';
  if (!group.consensusHash) return 'split';
  const top = group.hashCounts.get(group.consensusHash)?.length ?? 0;
  if (top / group.totalCount > 0.5) return 'majority';
  return 'split';
}

// ── Event Construction ────────────────────────────────────────────────

/**
 * Build an unsigned kind 1063 event that copies tags from the source artifact.
 * The host signer will add pubkey/id/sig when signing via nostr:sign.
 */
export function createSignedReleaseTemplate(sourceEvent: NostrEvent): {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
} {
  const tags = sourceEvent.tags.filter((t) => t[0] !== 'url');
  const urlTag = sourceEvent.tags.find((t) => t[0] === 'url');
  if (urlTag) tags.unshift(urlTag);

  return {
    kind: sourceEvent.kind,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: sourceEvent.content,
  };
}

// ── Data Loading ──────────────────────────────────────────────────────

/**
 * Load release artifacts via the host bridge.
 *
 * Two-phase approach:
 * 1. Fetch kind 5401 workflow runs → extract trusted ephemeral publisher keys
 * 2. Fetch kind 1063 (NIP-94 file metadata) from those keys, plus e-tag linked artifacts
 *
 * Returns all the data needed to render the release signing view.
 */
export interface ReleaseDataState {
  artifacts: ReleaseArtifact[];
  workflowRuns: Map<string, NostrEvent>;
  workerNames: Map<string, string>;
  ephemeralToWorker: Map<string, string>;
}

const emptyReleaseState = (): ReleaseDataState => ({
  artifacts: [],
  workflowRuns: new Map(),
  workerNames: new Map(),
  ephemeralToWorker: new Map(),
});

/**
 * Live release-data stream. Subscribes to the layered release events
 * (`buildReleaseEvents`) and folds them into the same shape the previous
 * one-shot `loadReleaseData` returned. Emits an updated state whenever new
 * events arrive (workflow runs, artifacts, loom jobs, worker ads).
 *
 * Cached per (repoNaddr, trustedMaintainers, filterKinds) so re-mounting
 * the Releases tab gets the current snapshot immediately.
 */
const releaseDataCache = new Map<string, BehaviorSubject<ReleaseDataState>>();

export function releaseData$(args: {
  repo: RepoContextNormalized;
  trustedMaintainers: string[];
  filterKinds?: number[];
}): Observable<ReleaseDataState> {
  const filterKinds = args.filterKinds ?? [1063];
  // `repoNaddr` is read off the host context shape — the type doesn't (yet)
  // declare it but the host is known to set it. Pre-existing convention.
  const repoNaddr = (args.repo as unknown as {repoNaddr?: string}).repoNaddr;
  const trustedNpubs = [...new Set(args.trustedMaintainers)].sort();
  const relays = dedupe([...args.repo.repoRelays, ...FALLBACK_RELAYS]);

  if (!repoNaddr || trustedNpubs.length === 0) {
    return new BehaviorSubject(emptyReleaseState());
  }

  const cacheKey = [repoNaddr, trustedNpubs.join(','), filterKinds.join(','), relays.slice().sort().join(',')].join('|');
  const existing = releaseDataCache.get(cacheKey);
  if (existing) return existing;

  const trustedSet = new Set(trustedNpubs);
  const subject = new BehaviorSubject<ReleaseDataState>(emptyReleaseState());

  // Mutable indexes accumulated over the stream's lifetime.
  const runIdMap = new Map<string, NostrEvent>(); // run id → workflow run event
  const publisherMap = new Map<string, NostrEvent>(); // publisher (or artifact-author) pubkey → run event
  const artifactEvents = new Map<string, NostrEvent>(); // artifact event id → event
  const ephemeralToWorker = new Map<string, string>(); // publisher pubkey → worker pubkey
  const workerAdByPubkey = new Map<string, NostrEvent>(); // worker pubkey → latest 10100 ad

  const recompute = () => {
    // Backfill publisherMap from artifact e-tags pointing at known runs.
    for (const event of artifactEvents.values()) {
      if (publisherMap.has(event.pubkey)) continue;
      const eTag = event.tags.find(t => t[0] === 'e')?.[1];
      if (eTag) {
        const run = runIdMap.get(eTag);
        if (run) publisherMap.set(event.pubkey, run);
      }
    }

    const artifacts: ReleaseArtifact[] = [];
    for (const event of artifactEvents.values()) {
      const hash = eventTagValue(event, 'x');
      if (!hash || !validateHash(hash)) continue;
      const publisherRun = publisherMap.get(event.pubkey);
      if (!publisherRun) continue;
      artifacts.push({
        event,
        hash,
        filename: eventTagValue(event, 'filename') ?? 'unknown',
        triggeredBy: eventTagValue(publisherRun, 'triggered-by') ?? '',
        ephemeralPubkey: event.pubkey,
        workflow: eventTagValue(publisherRun, 'workflow') ?? '',
        branch: eventTagValue(publisherRun, 'branch') ?? '',
        tags: Object.fromEntries(event.tags.map(t => [t[0], t[1]])),
      });
    }

    const workerNames = new Map<string, string>();
    for (const [ephKey, workerPk] of ephemeralToWorker) {
      const ad = workerAdByPubkey.get(workerPk);
      if (!ad) continue;
      try {
        const content = JSON.parse(ad.content || '{}');
        if (content.name) workerNames.set(ephKey, content.name);
      } catch {
        // ignore unparseable worker ads
      }
    }

    subject.next({
      artifacts,
      workflowRuns: new Map(publisherMap),
      workerNames,
      ephemeralToWorker: new Map(ephemeralToWorker),
    });
  };

  buildReleaseEvents({repoNaddr, trustedMaintainers: trustedNpubs, relays, filterKinds, viewerPubkey: args.repo.userPubkey}).subscribe(event => {
    eventStore.add(event as Parameters<typeof eventStore.add>[0]);

    if (event.kind === 5401) {
      const triggeredBy = eventTagValue(event, 'triggered-by');
      if (!triggeredBy || !trustedSet.has(triggeredBy)) return;
      const prior = runIdMap.get(event.id);
      if (prior && prior.created_at >= event.created_at) return;
      runIdMap.set(event.id, event);
      const publisher = eventTagValue(event, 'publisher');
      if (publisher) publisherMap.set(publisher, event);
      recompute();
    } else if (event.kind === 5100) {
      const eTag = event.tags.find(t => t[0] === 'e')?.[1];
      const pTag = event.tags.find(t => t[0] === 'p')?.[1];
      if (!eTag || !pTag) return;
      const run = runIdMap.get(eTag);
      if (!run) return;
      const publisher = eventTagValue(run, 'publisher');
      if (!publisher) return;
      if (ephemeralToWorker.get(publisher) === pTag) return;
      ephemeralToWorker.set(publisher, pTag);
      recompute();
    } else if (event.kind === 10100) {
      const prior = workerAdByPubkey.get(event.pubkey);
      if (prior && prior.created_at >= event.created_at) return;
      workerAdByPubkey.set(event.pubkey, event);
      recompute();
    } else if (filterKinds.includes(event.kind)) {
      const prior = artifactEvents.get(event.id);
      if (prior) return;
      artifactEvents.set(event.id, event);
      recompute();
    }
  });

  releaseDataCache.set(cacheKey, subject);
  return subject;
}

/**
 * Sign an event via the host bridge's nostr:sign handler.
 * Returns the full signed event.
 */
export async function signEvent(
  bridge: WidgetBridge,
  unsignedEvent: Record<string, unknown>
): Promise<NostrEvent> {
  const res: any = await bridge.request('nostr:sign', unsignedEvent);

  if (res?.error) {
    throw new Error(`Sign failed: ${res.error}`);
  }

  // The host returns the signed event
  const signed = res?.event ?? res;
  if (!signed?.id || !signed?.sig) {
    throw new Error('Host did not return a signed event');
  }

  return signed as NostrEvent;
}

/**
 * Sign and publish release attestations for the selected artifacts.
 */
export async function signAndPublishReleases(
  bridge: WidgetBridge,
  repo: RepoContextNormalized,
  artifacts: ReleaseArtifact[],
  publishRelays?: string[]
): Promise<number> {
  const relays = publishRelays ?? dedupe([...repo.repoRelays, ...FALLBACK_RELAYS]);
  let signedCount = 0;

  for (const artifact of artifacts) {
    const unsigned = createSignedReleaseTemplate(artifact.event);

    // Sign via host bridge
    const signed = await signEvent(bridge, unsigned);

    // Publish the signed event
    const publishRes: any = await bridge.request('nostr:publish', {
      event: signed,
      relays,
    });

    if (publishRes?.error) {
      console.error('[releases] publish failed:', publishRes.error);
    } else {
      signedCount++;
    }
  }

  return signedCount;
}

/**
 * Resolve a NIP-51 people list to an array of pubkeys.
 */
export async function resolveNip51List(
  bridge: WidgetBridge,
  listAddr: string,
  relays: string[]
): Promise<string[]> {
  const events = await queryEvents(bridge, relays, [
    { kinds: [30000], '#d': [listAddr] },
  ]);

  if (events.length === 0) return [];

  const first = events[0];
  if (!first) return [];

  return first.tags
    .filter((t) => t[0] === 'p')
    .map((t) => t[1])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}
