import type {
  BridgeLike,
  LoomWorker,
  NostrEvent,
  RerunDraft,
  RepoContextNormalized,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowStatus,
} from './types';
import { toRepoNostrUrl } from './nip07';
import { buildRepoEvents, eventStore } from './nostr';
import {
  BehaviorSubject,
  shareReplay,
  tap,
  type Observable,
} from 'rxjs';

const FALLBACK_RELAYS = ['wss://relay.sharegap.net', 'wss://nos.lol'];

/** Hive CI event kinds. */
export const KIND_WORKFLOW_RUN = 5401;
export const KIND_WORKFLOW_RESULT = 5402;
export const KIND_LOOM_JOB = 5100;
export const KIND_LOOM_RESULT = 5101;
export const KIND_LOOM_STATUS = 30100;
export const KIND_LOOM_WORKER = 10100;

function dedupe(values: string[]): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))
  );
}

export function eventTagValue(
  event: Pick<NostrEvent, 'tags'> | null | undefined,
  name: string
): string | undefined {
  return event?.tags?.find((tag) => tag[0] === name)?.[1];
}

export function eventTagValues(event: Pick<NostrEvent, 'tags'> | null | undefined, name: string): string[] {
  return (
    event?.tags
      ?.filter((tag) => tag[0] === name)
      .map((tag) => tag[1])
      .filter((value): value is string => typeof value === 'string' && value.length > 0) ?? []
  );
}

function workflowNameFromPath(workflowPath?: string): string {
  if (!workflowPath) return 'Workflow';
  return (
    workflowPath
      .split('/')
      .pop()
      ?.replace(/\.(yml|yaml)$/i, '') || 'Workflow'
  );
}

function normalizeStatus(status?: string): WorkflowStatus {
  switch (status) {
    case 'success':
      return 'success';
    case 'failed':
    case 'failure':
      return 'failure';
    case 'running':
      return 'running';
    case 'queued':
      return 'queued';
    case 'in_progress':
      return 'in_progress';
    case 'cancelled':
      return 'cancelled';
    case 'pending':
      return 'pending';
    case 'skipped':
      return 'skipped';
    default:
      return status ? 'unknown' : 'pending';
  }
}

function resolveRunStatus(
  workflowLogEvent?: NostrEvent,
  loomStatusEvent?: NostrEvent,
  loomResultEvent?: NostrEvent
): { status: WorkflowStatus; duration?: number; inferredFailure: boolean } {
  if (workflowLogEvent) {
    // The workflow log event is the authoritative final workflow-level
    // outcome from the Hive CI publisher. An individual loom job may have
    // failed and been retried; trust the workflow event.
    const status = normalizeStatus(eventTagValue(workflowLogEvent, 'status'));
    const duration = Number.parseInt(eventTagValue(workflowLogEvent, 'duration') || '', 10);
    return {
      status,
      duration: Number.isFinite(duration) ? duration : undefined,
      inferredFailure: false,
    };
  }

  if (loomResultEvent) {
    const success = eventTagValue(loomResultEvent, 'success');
    const exitCode = eventTagValue(loomResultEvent, 'exit_code');
    const isSuccess = success === 'true' || exitCode === '0';
    return {
      status: isSuccess ? 'success' : 'failure',
      inferredFailure: !isSuccess,
    };
  }

  if (loomStatusEvent) {
    return {
      status: normalizeStatus(eventTagValue(loomStatusEvent, 'status')),
      inferredFailure: false,
    };
  }

  return { status: 'pending', inferredFailure: false };
}

function parseLegacyJobEvent(event: NostrEvent): WorkflowRun {
  const argsTag = event.tags.find((tag) => tag[0] === 'args');
  const args = argsTag ? argsTag.slice(1) : [];

  let workflowPath = '';
  if (args.length >= 2 && args[0] === '-c') {
    const bashCommand = args[1];
    const match =
      typeof bashCommand === 'string' ? bashCommand.match(/act -W (\S+\.(?:yml|yaml))/) : null;
    workflowPath = match?.[1] || '';
  }

  return {
    id: event.id,
    name: workflowNameFromPath(workflowPath),
    workflowPath,
    status: 'pending',
    branch: eventTagValue(event, 'branch') || 'main',
    commit: event.id.slice(0, 7),
    commitMessage: `Workflow run: ${workflowNameFromPath(workflowPath)}`,
    actor: event.pubkey.slice(0, 12),
    event: 'manual',
    createdAt: event.created_at * 1000,
    updatedAt: event.created_at * 1000,
    workerPubkey: eventTagValue(event, 'p'),
    loomJobEvent: event,
  };
}

function parseWorkflowRunEvent(event: NostrEvent): WorkflowRun {
  const workflowPath = eventTagValue(event, 'workflow') || '';
  const trigger = eventTagValue(event, 'trigger') || 'manual';
  const actor = eventTagValue(event, 'triggered-by') || event.pubkey;
  const branch = eventTagValue(event, 'branch') || 'main';
  const commit = eventTagValue(event, 'commit') || '';

  return {
    id: event.id,
    name: workflowNameFromPath(workflowPath),
    workflowPath,
    status: 'pending',
    branch,
    commit,
    commitMessage: `Workflow run: ${workflowNameFromPath(workflowPath)}`,
    actor,
    event: trigger,
    createdAt: event.created_at * 1000,
    updatedAt: event.created_at * 1000,
    runEvent: event,
  };
}

/**
 * Query Nostr events via the host bridge.
 *
 * The host expects `{ relays, filter }` (singular filter object).
 * When multiple filters are needed we issue parallel requests and merge.
 */
export async function queryEvents(
  bridge: BridgeLike,
  relays: string[],
  filters: Array<Record<string, unknown>>
): Promise<NostrEvent[]> {
  const effectiveRelays = relays.length > 0 ? relays : FALLBACK_RELAYS;

  console.log('[pipelines] queryEvents:', {
    filterCount: filters.length,
    relayCount: effectiveRelays.length,
    kinds: filters.map(f => f.kinds),
  });

  // Run each filter as its own bridge request (host expects singular `filter`)
  const results = await Promise.all(
    filters.map(async (filter) => {
      console.log('[pipelines] nostr:query request:', JSON.stringify(filter));
      const response = await bridge.request('nostr:query', {
        filter,
        relays: effectiveRelays,
      });
      console.log('[pipelines] nostr:query response:', typeof response, response && typeof response === 'object' ? Object.keys(response) : response);

      if (response && typeof response === 'object' && 'error' in response) {
        throw new Error(
          String((response as { error?: string }).error || 'Unknown Nostr query error')
        );
      }

      if (
        response &&
        typeof response === 'object' &&
        'status' in response &&
        (response as { status?: string }).status === 'ok' &&
        Array.isArray((response as { events?: unknown[] }).events)
      ) {
        return (response as unknown as { events: NostrEvent[] }).events;
      }

      return [];
    })
  );

  // Deduplicate by event id across filter results
  const seen = new Set<string>();
  const merged: NostrEvent[] = [];
  for (const batch of results) {
    for (const event of batch) {
      if (!seen.has(event.id)) {
        seen.add(event.id);
        merged.push(event);
      }
    }
  }
  return merged;
}

export async function loadWorkflowRunDetail(
  bridge: BridgeLike,
  repo: RepoContextNormalized,
  runId: string
): Promise<WorkflowRunDetail | null> {
  const relays = dedupe([...repo.repoRelays, ...FALLBACK_RELAYS]);
  const [runEvents, workflowLogEvents, loomJobEvents, topLevelResultEvents, topLevelStatusEvents] =
    await Promise.all([
      queryEvents(bridge, relays, [{ kinds: [5401], ids: [runId], limit: 1 }]),
      queryEvents(bridge, relays, [{ kinds: [5402], '#e': [runId], limit: 20 }]),
      queryEvents(bridge, relays, [
        { kinds: [5100], '#e': [runId], limit: 20 },
        { kinds: [5100], ids: [runId], limit: 1 },
      ]),
      queryEvents(bridge, relays, [{ kinds: [5101], '#e': [runId], limit: 20 }]),
      queryEvents(bridge, relays, [{ kinds: [30100], '#e': [runId], limit: 20 }]),
    ]);

  const runEvent = runEvents[0];
  const loomJobEvent = loomJobEvents.sort((a, b) => b.created_at - a.created_at)[0];
  const loomJobId = loomJobEvent?.id;

  const [childResultEvents, childStatusEvents] = loomJobId
    ? await Promise.all([
        queryEvents(bridge, relays, [{ kinds: [5101], '#e': [loomJobId], limit: 20 }]),
        queryEvents(bridge, relays, [{ kinds: [30100], '#e': [loomJobId], limit: 20 }]),
      ])
    : [[], []];

  const workflowLogEvent = workflowLogEvents.sort((a, b) => b.created_at - a.created_at)[0];
  const loomResultEvent = [...topLevelResultEvents, ...childResultEvents].sort(
    (a, b) => b.created_at - a.created_at
  )[0];
  const loomStatusEvent = [...topLevelStatusEvents, ...childStatusEvents].sort(
    (a, b) => b.created_at - a.created_at
  )[0];

  if (!runEvent && !loomJobEvent) return null;

  const baseRun = runEvent ? parseWorkflowRunEvent(runEvent) : parseLegacyJobEvent(loomJobEvent!);
  const resolved = resolveRunStatus(workflowLogEvent, loomStatusEvent, loomResultEvent);

  const run: WorkflowRun = {
    ...baseRun,
    ...resolved,
    workflowLogEvent,
    loomJobEvent,
    loomStatusEvent,
    loomResultEvent,
    workerPubkey: eventTagValue(loomJobEvent, 'p'),
  };

  const workerPubkey = run.workerPubkey;
  let worker: LoomWorker | null = null;

  if (workerPubkey) {
    const workerEvents = await queryEvents(bridge, relays, [
      { kinds: [10100], authors: [workerPubkey], limit: 10 },
    ]);
    worker =
      workerEvents
        .sort((a, b) => b.created_at - a.created_at)
        .map(parseLoomWorker)
        .find((candidate): candidate is LoomWorker => candidate !== null) || null;
  }

  return { run, worker };
}

export function parseLoomWorker(event: NostrEvent): LoomWorker | null {
  try {
    const content = JSON.parse(event.content || '{}');
    if (!content?.name) return null;

    const softwareTags = event.tags.filter((tag) => tag[0] === 'S');
    const actSoftware = softwareTags.find((tag) => tag[1] === 'act');
    const priceTags = event.tags.filter((tag) => tag[0] === 'price');

    return {
      pubkey: event.pubkey,
      name: content.name,
      description: content.description || '',
      architecture: eventTagValue(event, 'A'),
      actVersion: actSoftware?.[2],
      pricing:
        priceTags.length > 0
          ? {
              perSecondRate: Number.parseFloat(priceTags[0]?.[2] || ''),
              unit: priceTags[0]?.[3],
            }
          : undefined,
      mints: priceTags
        .map((tag) => tag[4])
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
      minDuration: Number.parseInt(eventTagValue(event, 'min_duration') || '', 10) || undefined,
      maxDuration: Number.parseInt(eventTagValue(event, 'max_duration') || '', 10) || undefined,
      maxConcurrentJobs:
        Number.parseInt(String(content.max_concurrent_jobs || ''), 10) || undefined,
      currentQueueDepth:
        Number.parseInt(String(content.current_queue_depth || ''), 10) || undefined,
      online: Date.now() - event.created_at * 1000 < 5 * 60 * 1000,
      lastSeen: event.created_at,
    };
  } catch {
    return null;
  }
}

export async function loadWorkers(
  bridge: BridgeLike,
  repo: RepoContextNormalized
): Promise<LoomWorker[]> {
  const relays = dedupe([...repo.repoRelays, ...FALLBACK_RELAYS]);
  const workerEvents = await queryEvents(bridge, relays, [{ kinds: [10100], limit: 200 }]);

  const latestByPubkey = new Map<string, NostrEvent>();
  for (const event of workerEvents) {
    const existing = latestByPubkey.get(event.pubkey);
    if (!existing || event.created_at > existing.created_at) {
      latestByPubkey.set(event.pubkey, event);
    }
  }

  return Array.from(latestByPubkey.values())
    .map(parseLoomWorker)
    .filter((worker): worker is LoomWorker => worker !== null)
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return (a.currentQueueDepth || 0) - (b.currentQueueDepth || 0);
    });
}

export function statusLabel(status: WorkflowStatus): string {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  }
}

export function publicLinkForRun(runId: string): string {
  return `nostr:${runId}`;
}

export function externalUrlForEvent(event: NostrEvent | undefined): string | undefined {
  return (
    eventTagValue(event, 'log_url') || eventTagValue(event, 'url') || eventTagValue(event, 'stdout') || undefined
  );
}

export function eventSummary(event: NostrEvent | undefined): string {
  if (!event) return '—';
  const notableTags = ['status', 'exit_code', 'workflow', 'branch', 'commit', 'trigger'];

  const bits = notableTags
    .map((name) => {
      const value = eventTagValue(event, name);
      return value ? `${name}: ${value}` : null;
    })
    .filter(Boolean);

  if (bits.length > 0) return bits.join(' • ');
  return `${event.kind} event`;
}

export function eventERefs(event: NostrEvent | undefined): string[] {
  return eventTagValues(event, 'e');
}

export function buildRerunDraft(
  repo: RepoContextNormalized,
  detail: WorkflowRunDetail | null
): RerunDraft | null {
  const loomJobEvent = detail?.run.loomJobEvent;
  if (!repo.repoAddress || !loomJobEvent) return null;

  const command = eventTagValue(loomJobEvent, 'cmd');
  const argsTag = loomJobEvent.tags.find((tag) => tag[0] === 'args');
  const workerPubkey = eventTagValue(loomJobEvent, 'p');

  if (!command || !argsTag || !workerPubkey) return null;

  const envVars = loomJobEvent.tags
    .filter((tag) => tag[0] === 'env' && typeof tag[1] === 'string' && typeof tag[2] === 'string')
    .filter(
      (tag): tag is [string, string, string, ...string[]] =>
        typeof tag[1] === 'string' && typeof tag[2] === 'string' && !tag[1].startsWith('HIVE_CI_')
    )
    .map((tag) => ({ key: tag[1], value: tag[2] }));

  const publishRelays = dedupe([...repo.repoRelays, ...FALLBACK_RELAYS]);

  return {
    repoAddress: repo.repoAddress,
    workflowPath: detail?.run.workflowPath || eventTagValue(detail?.run.runEvent, 'workflow') || '',
    branch: detail?.run.branch || eventTagValue(detail?.run.runEvent, 'branch') || 'main',
    commit: detail?.run.commit || eventTagValue(detail?.run.runEvent, 'commit') || '',
    workerPubkey,
    command,
    args: argsTag.slice(1),
    envVars,
    repoNostrUrl: toRepoNostrUrl(repo.repoAddress, publishRelays),
    publishRelays,
  };
}

// ── Event-driven state updates ─────────────────────────────────────
// These functions merge a single incoming subscription event into the
// existing local state, avoiding any additional relay queries.

/**
 * Merge a single Nostr event into the existing workflow runs list.
 *
 * - kind 5401 (workflow run): adds a new run or ignores duplicates
 * - kind 5100 (loom job):     attaches to its parent run via #e tag
 * - kind 5402 (workflow log):  attaches result/log to the parent run
 * - kind 5101 (loom result):   attaches result to run or its loom job
 * - kind 30100 (loom status):  attaches status to run or its loom job
 *
 * Returns a new array (or the same reference if nothing changed).
 */
export function mergeEventIntoRuns(
  runs: WorkflowRun[],
  event: NostrEvent,
  repoAddress?: string,
): WorkflowRun[] {
  const kind = event.kind;

  // ── New workflow run ──────────────────────────────────────────────
  if (kind === 5401) {
    if (runs.some(r => r.id === event.id)) return runs; // duplicate
    // Only accept runs for this repo
    if (repoAddress && eventTagValue(event, 'a') !== repoAddress) return runs;
    const newRun = parseWorkflowRunEvent(event);
    return [newRun, ...runs];
  }

  // ── Legacy loom job (no 5401 parent) ─────────────────────────────
  if (kind === 5100) {
    const parentRunId = eventTagValue(event, 'e');
    if (parentRunId) {
      // Attach as loom job to existing run
      return updateRunById(runs, parentRunId, run => ({
        ...run,
        loomJobEvent: newerEvent(run.loomJobEvent, event),
        workerPubkey: run.workerPubkey || eventTagValue(event, 'p'),
      }));
    }
    // Standalone legacy job — add if not duplicate
    if (runs.some(r => r.id === event.id)) return runs;
    if (repoAddress && eventTagValue(event, 'a') !== repoAddress) return runs;
    return [parseLegacyJobEvent(event), ...runs];
  }

  // For kinds that reference a run or job via #e tags
  const eRefs = eventTagValues(event, 'e');
  if (eRefs.length === 0) return runs;

  // ── Workflow log / result (5402) ─────────────────────────────────
  if (kind === 5402) {
    return updateRunByERefs(runs, eRefs, run => {
      const updated = { ...run, workflowLogEvent: newerEvent(run.workflowLogEvent, event) };
      return reResolveStatus(updated);
    });
  }

  // ── Loom result (5101) ───────────────────────────────────────────
  if (kind === 5101) {
    return updateRunByERefs(runs, eRefs, run => {
      const updated = { ...run, loomResultEvent: newerEvent(run.loomResultEvent, event) };
      return reResolveStatus(updated);
    });
  }

  // ── Loom status (30100) ──────────────────────────────────────────
  if (kind === 30100) {
    return updateRunByERefs(runs, eRefs, run => {
      const updated = { ...run, loomStatusEvent: newerEvent(run.loomStatusEvent, event) };
      return reResolveStatus(updated);
    });
  }

  return runs;
}

/**
 * Merge a single Nostr event into the selected run detail.
 * Returns an updated detail or the same reference if nothing changed.
 */
export function mergeEventIntoDetail(
  detail: WorkflowRunDetail,
  event: NostrEvent,
): WorkflowRunDetail {
  const run = detail.run;
  const eRefs = eventTagValues(event, 'e');
  const matchesRun = eRefs.includes(run.id);
  const matchesJob = run.loomJobEvent?.id && eRefs.includes(run.loomJobEvent.id);

  if (!matchesRun && !matchesJob) return detail;

  const kind = event.kind;

  if (kind === 5100) {
    const updated = {
      ...run,
      loomJobEvent: newerEvent(run.loomJobEvent, event),
      workerPubkey: run.workerPubkey || eventTagValue(event, 'p'),
    };
    return { ...detail, run: reResolveStatus(updated) };
  }

  if (kind === 5402) {
    const updated = { ...run, workflowLogEvent: newerEvent(run.workflowLogEvent, event) };
    return { ...detail, run: reResolveStatus(updated) };
  }

  if (kind === 5101) {
    const updated = { ...run, loomResultEvent: newerEvent(run.loomResultEvent, event) };
    return { ...detail, run: reResolveStatus(updated) };
  }

  if (kind === 30100) {
    const updated = { ...run, loomStatusEvent: newerEvent(run.loomStatusEvent, event) };
    return { ...detail, run: reResolveStatus(updated) };
  }

  return detail;
}

// ── Helpers ────────────────────────────────────────────────────────

/** Keep the newer event (by created_at), or the incoming one if there's no existing. */
function newerEvent(existing: NostrEvent | undefined, incoming: NostrEvent): NostrEvent {
  if (!existing) return incoming;
  return incoming.created_at >= existing.created_at ? incoming : existing;
}

/** Re-derive status + duration from the events currently attached to a run. */
function reResolveStatus(run: WorkflowRun): WorkflowRun {
  const resolved = resolveRunStatus(run.workflowLogEvent, run.loomStatusEvent, run.loomResultEvent);
  return { ...run, ...resolved, updatedAt: Date.now() };
}

/** Update a run matched by its id. */
function updateRunById(
  runs: WorkflowRun[],
  runId: string,
  updater: (run: WorkflowRun) => WorkflowRun,
): WorkflowRun[] {
  let changed = false;
  const next = runs.map(run => {
    if (run.id !== runId) return run;
    changed = true;
    return updater(run);
  });
  return changed ? next : runs;
}

/** Update a run whose id or loomJobEvent.id appears in the event's #e refs. */
function updateRunByERefs(
  runs: WorkflowRun[],
  eRefs: string[],
  updater: (run: WorkflowRun) => WorkflowRun,
): WorkflowRun[] {
  let changed = false;
  const next = runs.map(run => {
    const matches = eRefs.includes(run.id) ||
      (run.loomJobEvent?.id && eRefs.includes(run.loomJobEvent.id));
    if (!matches) return run;
    changed = true;
    return updater(run);
  });
  return changed ? next : runs;
}

// ── Live streams ───────────────────────────────────────────────────

// Module-scoped caches keyed on repoAddress. Survive component HMR so
// remounted subscribers get the current state immediately.
const repoEventsCache = new Map<string, Observable<NostrEvent>>();
const repoRunsCache = new Map<string, BehaviorSubject<WorkflowRun[]>>();

/** Cached, shared event stream for a repo. Replays all past events to late subscribers. */
export function repoEvents$(
  repoAddress: string,
  relays: string[],
  trustedAuthors: string[],
): Observable<NostrEvent> {
  const existing = repoEventsCache.get(repoAddress);
  if (existing) return existing;

  const shared = buildRepoEvents(repoAddress, relays, trustedAuthors).pipe(
    tap(event => eventStore.add(event as Parameters<typeof eventStore.add>[0])),
    shareReplay({bufferSize: Infinity, refCount: false}),
  );
  // Keep the upstream alive even without subscribers so events keep accruing.
  shared.subscribe();
  repoEventsCache.set(repoAddress, shared);
  return shared;
}

/** Cached folded runs list. BehaviorSubject — emits current array on subscribe. */
export function repoRuns$(
  repoAddress: string,
  relays: string[],
  trustedAuthors: string[],
): Observable<WorkflowRun[]> {
  const existing = repoRunsCache.get(repoAddress);
  if (existing) return existing;

  const subject = new BehaviorSubject<WorkflowRun[]>([]);
  repoEvents$(repoAddress, relays, trustedAuthors).subscribe(event => {
    subject.next(mergeEventIntoRuns(subject.value, event, repoAddress));
  });
  repoRunsCache.set(repoAddress, subject);
  return subject;
}
