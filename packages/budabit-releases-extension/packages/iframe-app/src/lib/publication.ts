import type { NostrEvent, WidgetBridge } from 'budabit-sdk';
import type { EventTemplate } from 'nostr-tools';
import { isMaintainer, normalizeContext, record, type RepoContext } from './context.js';
import { appCoordinate, authorizedRelease, verifiedEvent } from './trust.js';
import {
  buildApplicationEvent,
  buildAssetEvent,
  buildReleaseEvent,
  getRelays,
  loadRepoApps,
  tagValues,
} from './releases.js';
import type { Artifact } from './types.js';

export interface ReleaseDraft {
  appId: string;
  appPubkey: string;
  appName?: string;
  newApplication: boolean;
  version: string;
  channel: string;
  releaseNotes: string;
  artifacts: Artifact[];
}
export interface PublicationJournal {
  schema: 1;
  batchId: string;
  repoAddress: string;
  publisher: string;
  events: NostrEvent[];
  accepted: string[];
  /** Host storage token, held in memory only; never persisted inside the batch. */
  revision?: string;
}
const JOURNAL_KEY = 'release-publication-v1';
const journalKey = (repo: RepoContext) => `${JOURNAL_KEY}:${repo.userPubkey}`;

export class JournalConflictError extends Error {
  constructor() {
    super('Recovery changed in another session. Refresh and review the current saved publication.');
  }
}

/** Invalid data still has a pinned discard target; transport failures do not. */
export class JournalRecoveryError extends Error {
  constructor(
    message: string,
    readonly revision: string
  ) {
    super(message);
  }
}

const isRevision = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function expectedRevision(journal: PublicationJournal): string {
  if (!isRevision(journal.revision)) throw new JournalConflictError();
  return journal.revision;
}

export async function requestOk(
  bridge: WidgetBridge,
  action: string,
  payload: unknown
): Promise<Record<string, unknown>> {
  const response = record(await bridge.request(action, payload));
  if (response.status === 'conflict') throw new JournalConflictError();
  if (typeof response.error === 'string') throw new Error(response.error);
  if (response.status !== 'ok') throw new Error(`Unexpected or incomplete ${action} response`);
  return response;
}

async function assertActive(bridge: WidgetBridge, repo: RepoContext, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const current = normalizeContext(await requestOk(bridge, 'context:getRepo', {}));
  signal?.throwIfAborted();
  if (
    !current ||
    current.repoAddress !== repo.repoAddress ||
    current.userPubkey !== repo.userPubkey ||
    JSON.stringify([...current.maintainers].sort()) !==
      JSON.stringify([...repo.maintainers].sort()) ||
    !isMaintainer(current)
  ) {
    throw new Error('Repository or signing account changed; publication stopped');
  }
}

const scope = (repo: RepoContext) => ({
  expectedRepoAddress: repo.repoAddress,
  expectedPubkey: repo.userPubkey,
});
const templateOf = (event: NostrEvent | EventTemplate) =>
  JSON.stringify([event.kind, event.created_at, event.tags, event.content]);

/** Sign every fixed template before the first publish. A lost signing response cannot publish anything. */
export async function preparePublication(
  bridge: WidgetBridge,
  repo: RepoContext,
  draft: ReleaseDraft,
  signal?: AbortSignal
): Promise<PublicationJournal> {
  const frozen = structuredClone(JSON.parse(JSON.stringify(draft)) as ReleaseDraft);
  if (!frozen.artifacts.length || frozen.artifacts.length > 50)
    throw new Error('Select between 1 and 50 artifacts');
  if (
    !repo.maintainers.includes(frozen.appPubkey) ||
    (frozen.newApplication && frozen.appPubkey !== repo.userPubkey)
  )
    throw new Error('Unauthorized application publisher');
  if (
    new Set(frozen.artifacts.map((a) => a.pipelineRunId)).size !== 1 ||
    !frozen.artifacts[0]?.pipelineRunId
  )
    throw new Error('Select artifacts from one authenticated run');
  const created_at = Math.floor(Date.now() / 1000);
  if (!frozen.newApplication) {
    await assertActive(bridge, repo, signal);
    const currentApps = await loadRepoApps(bridge, repo);
    if (
      !currentApps.some((app) => appCoordinate(app) === `32267:${frozen.appPubkey}:${frozen.appId}`)
    ) {
      throw new Error('Application repository linkage changed; rediscover before signing');
    }
  }
  const relays = getRelays(repo.repoRelays);
  const templates: Record<string, unknown>[] = [];
  if (frozen.newApplication)
    templates.push(
      buildApplicationEvent({
        appId: frozen.appId,
        name: frozen.appName || frozen.appId,
        repoAddress: repo.repoAddress,
        repoRelay: relays[0] ?? '',
      })
    );
  templates.push(
    ...frozen.artifacts.map((artifact) =>
      buildAssetEvent({ appId: frozen.appId, version: frozen.version, artifact })
    )
  );
  // Validate the release before requesting any signatures.
  const release = buildReleaseEvent({
    ...frozen,
    assetEventIds: [],
    relayHint: relays[0],
    platforms: frozen.artifacts.flatMap((a) => a.platforms ?? []),
  });
  // Fail before signer prompts on older hosts or an already occupied slot. Two
  // concurrent creators may both sign, but only the atomic empty-slot claim wins.
  const snapshot = await readJournalSnapshot(bridge, repo, signal);
  if (snapshot.revision !== null) throw new JournalConflictError();
  const events: NostrEvent[] = [];
  for (let index = 0; index <= templates.length; index++) {
    const template =
      index === templates.length
        ? {
            ...release,
            tags: [
              ...(release.tags as string[][]),
              ...events.filter((e) => e.kind === 3063).map((e) => ['e', e.id, relays[0] ?? '']),
            ],
            created_at,
          }
        : { ...templates[index], created_at };
    await assertActive(bridge, repo, signal);
    const response = await requestOk(bridge, 'nostr:sign', { ...template, ...scope(repo) });
    signal?.throwIfAborted();
    const signed = verifiedEvent(response.event);
    if (
      !signed ||
      signed.pubkey !== repo.userPubkey ||
      templateOf(signed) !== templateOf(template as EventTemplate)
    ) {
      throw new Error('Signer returned a different event or publisher');
    }
    events.push(signed);
  }
  const journal: PublicationJournal = {
    schema: 1,
    batchId: crypto.randomUUID(),
    repoAddress: repo.repoAddress,
    publisher: repo.userPubkey,
    events,
    accepted: [],
  };
  await saveJournal(bridge, repo, journal, null, signal);
  return journal;
}

async function saveJournal(
  bridge: WidgetBridge,
  repo: RepoContext,
  journal: PublicationJournal,
  revision: string | null,
  signal?: AbortSignal
) {
  const { schema, batchId, repoAddress, publisher, events, accepted } = journal;
  const data = { schema, batchId, repoAddress, publisher, events, accepted };
  const next = await replaceJournal(bridge, repo, revision, data, signal);
  if (!isRevision(next)) throw new Error('Host did not confirm the saved recovery revision');
  journal.revision = next;
}

async function replaceJournal(
  bridge: WidgetBridge,
  repo: RepoContext,
  revision: string | null,
  data: unknown,
  signal?: AbortSignal
) {
  await assertActive(bridge, repo, signal);
  const response = await requestOk(bridge, 'storage:compareAndSet', {
    key: journalKey(repo),
    repoScoped: true,
    ...scope(repo),
    expectedRevision: revision,
    data: JSON.parse(JSON.stringify(data)) as unknown,
  });
  return response.revision;
}

async function readJournalSnapshot(bridge: WidgetBridge, repo: RepoContext, signal?: AbortSignal) {
  await assertActive(bridge, repo, signal);
  const response = await requestOk(bridge, 'storage:get', {
    key: journalKey(repo),
    repoScoped: true,
    ...scope(repo),
    withRevision: true,
  });
  signal?.throwIfAborted();
  if (
    response.atomic !== true ||
    (response.revision !== null && !isRevision(response.revision)) ||
    (response.revision === null && response.data !== null)
  ) {
    throw new Error(
      'Atomic release recovery storage is required; update Budabit before publishing'
    );
  }
  return { data: response.data, revision: response.revision };
}

export async function loadJournal(
  bridge: WidgetBridge,
  repo: RepoContext,
  signal?: AbortSignal
): Promise<PublicationJournal | null> {
  const snapshot = await readJournalSnapshot(bridge, repo, signal);
  if (snapshot.revision === null) return null;
  try {
    const journal = await validateJournal(bridge, repo, snapshot.data, signal);
    journal.revision = snapshot.revision;
    return journal;
  } catch (error) {
    signal?.throwIfAborted();
    throw new JournalRecoveryError(
      error instanceof Error ? error.message : String(error),
      snapshot.revision
    );
  }
}

async function validateJournal(
  bridge: WidgetBridge,
  repo: RepoContext,
  input: unknown,
  signal?: AbortSignal
): Promise<PublicationJournal> {
  const value = record(input);
  if (
    value.schema !== 1 ||
    value.repoAddress !== repo.repoAddress ||
    value.publisher !== repo.userPubkey ||
    (value.batchId !== undefined &&
      (typeof value.batchId !== 'string' || !value.batchId || value.batchId.length > 128)) ||
    !Array.isArray(value.events) ||
    value.events.length < 2 ||
    value.events.length > 52
  )
    throw new Error('Stored publication belongs to another account or is invalid');
  const events = value.events.map(verifiedEvent);
  if (events.some((e) => !e || e.pubkey !== repo.userPubkey))
    throw new Error('Stored publication has invalid signatures');
  const verified = events as NostrEvent[];
  const release = verified.at(-1);
  if (!release) throw new Error('Stored publication is empty');
  const appEvents = verified.filter((e) => e.kind === 32267);
  await assertActive(bridge, repo, signal);
  const apps = await loadRepoApps(bridge, repo, appEvents);
  await assertActive(bridge, repo, signal);
  const assets = verified.filter((e) => e.kind === 3063);
  if (
    appEvents.length > 1 ||
    verified.filter((e) => e.kind === 30063).length !== 1 ||
    verified.some((e) => ![32267, 3063, 30063].includes(e.kind)) ||
    !authorizedRelease(release, repo, apps) ||
    JSON.stringify(tagValues(release, 'e')) !== JSON.stringify(assets.map((e) => e.id))
  )
    throw new Error('Stored publication has inconsistent asset/application links');
  return {
    schema: 1,
    // Previously saved schema-1 journals have no batch ID. Keep their signed IDs;
    // their exact storage revision protects the first conditional migration.
    batchId: typeof value.batchId === 'string' ? value.batchId : `legacy:${release.id}`,
    repoAddress: repo.repoAddress,
    publisher: repo.userPubkey,
    events: verified,
    accepted: [],
  };
}

/** Retry the same signed event IDs, never re-sign. Resume deliberately republishes: local acks are not authoritative. */
export async function publishJournal(
  bridge: WidgetBridge,
  repo: RepoContext,
  journal: PublicationJournal,
  signal?: AbortSignal,
  onProgress?: (message: string) => void
): Promise<void> {
  if (journal.publisher !== repo.userPubkey || journal.repoAddress !== repo.repoAddress)
    throw new Error('Publication scope changed');
  // Always validate here as well as on restore: a same-session retry can outlive
  // an application revocation. Pin the independently verified batch across awaits.
  const revision = expectedRevision(journal);
  const current = await validateJournal(bridge, repo, journal, signal);
  // Check ownership before any remote write, and before every subsequent progress
  // update/cleanup. Never recreate a slot removed or replaced by another session.
  await saveJournal(bridge, repo, current, revision, signal);
  Object.assign(journal, current);
  for (const event of current.events) {
    await assertActive(bridge, repo, signal);
    onProgress?.(`Publishing ${journal.accepted.length + 1} of ${journal.events.length} events…`);
    const response = await requestOk(bridge, 'nostr:publish', {
      event,
      relays: getRelays(repo.repoRelays),
      ...scope(repo),
    });
    const result = record(response.result);
    if (
      result.eventId !== event.id ||
      typeof result.successCount !== 'number' ||
      result.successCount < 1
    ) {
      throw new Error('Publication acceptance is unknown; retry the saved signed events');
    }
    current.accepted.push(event.id);
    await saveJournal(bridge, repo, current, expectedRevision(current), signal);
    Object.assign(journal, current);
  }
  await discardJournal(bridge, repo, expectedRevision(current), signal);
}

/** Delete only local recovery state, after explicit user confirmation in the UI. */
export async function discardJournal(
  bridge: WidgetBridge,
  repo: RepoContext,
  revision: string,
  signal?: AbortSignal
) {
  if (!isRevision(revision)) throw new JournalConflictError();
  const next = await replaceJournal(bridge, repo, revision, null, signal);
  if (next !== null) throw new Error('Host did not confirm removal of the saved recovery revision');
}
