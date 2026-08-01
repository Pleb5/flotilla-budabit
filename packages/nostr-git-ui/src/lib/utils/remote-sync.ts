import {
  getGitServiceApiFromUrl,
  parseRepoUrl,
  type GitOperationProgressEvent,
  type NostrEvent,
  type OperationStatus,
  type WorkerMutationOperation,
} from "@nostr-git/core";
import { createRepoAnnouncementEvent, type RepoCommunityBinding } from "@nostr-git/core/events";
import { sanitizeRelays } from "@nostr-git/core/utils";

import {
  buildGraspRepoUrls,
  createGraspRefMap,
  createGraspAnnouncementAndState,
  extractPublishRelayAck,
  fetchLatestGraspRepoStateEvent,
  getGraspRefFullName,
  getGraspStateHeadFromEvent,
  getGraspStateRefsFromEvent,
  mergeGraspRefs,
  normalizeGraspOrigins,
  publishGraspEventWithRetry,
  resolveGraspStateHead,
  toNpubOrSelf,
  verifyGraspEventAfterPush,
  waitForGraspProvisioning,
  type FetchRelayEvents,
  type GraspRef,
  type PublishRepoEvent,
  type RepoCreationProvisionalEvent,
} from "./grasp-pipeline.js";
import { trackLatestRepoMetadataCreatedAt } from "./import-repo-metadata.js";
import {
  getProviderBaseUrl,
  type RemoteTargetProvider,
  type RemoteTargetSelection,
} from "./remote-targets.js";
import {
  createWorkerOperationIdFactory,
  waitForWorkerOperationTerminal,
} from "./worker-operation-session.js";

export interface RemoteSyncRef {
  type: "heads" | "tags";
  name: string;
  ref: string;
  commit?: string;
}

export type RemoteSyncTargetStage =
  | "planned"
  | "creating"
  | "created"
  | "pushing"
  | "verified"
  | "failed"
  | "unknown";
export type RemoteSyncRefStage =
  | "planned"
  | "pushing"
  | "pushed"
  | "verified"
  | "failed"
  | "unknown";

export interface RemoteSyncRefCheckpoint {
  ref: string;
  commit?: string;
  stage: RemoteSyncRefStage;
  error?: string;
}

export interface RemoteSyncTargetResult {
  id: string;
  label: string;
  provider: RemoteTargetProvider;
  success: boolean;
  remoteUrl?: string;
  webUrl?: string;
  error?: string;
  createdRemote?: boolean;
  pushedRefs?: string[];
  failedRefs?: Array<{ ref: string; error: string }>;
  warnings?: string[];
  relayUrl?: string;
  outcome?: "ok" | "failed" | "unknown";
  cleanup?: {
    attempted: boolean;
    success: boolean;
    unknown?: boolean;
    error?: string;
  };
  provisionalAnnouncementEvent?: NostrEvent;
  provisionalStateEvents?: NostrEvent[];
}

export interface RemoteSyncCheckpoint {
  action: "target" | "create" | "publish" | "push" | "verify" | "cleanup";
  position: "before" | "after";
  target: Pick<RemoteTargetSelection, "id" | "label" | "provider" | "host" | "relayUrl">;
  stage: RemoteSyncTargetStage;
  remoteUrl?: string;
  webUrl?: string;
  createdRemote?: boolean;
  ref?: RemoteSyncRefCheckpoint;
  refs?: RemoteSyncRefCheckpoint[];
  cleanup?: RemoteSyncTargetResult["cleanup"];
  error?: string;
}

export type RemoteSyncCheckpointCallback = (
  checkpoint: RemoteSyncCheckpoint
) => Promise<void> | void;
export type RemoteSyncTargetSettledCallback = (
  result: RemoteSyncTargetResult
) => Promise<void> | void;
export type RemoteSyncWorkerOperationCallback = (
  operationId: string,
  operation: WorkerMutationOperation
) => Promise<void> | void;

export interface SyncLocalRepoToTargetsOptions {
  workerApi: any;
  localRepoId: string;
  repoName: string;
  repoDescription: string;
  defaultBranch: string;
  refs: RemoteSyncRef[];
  targets: RemoteTargetSelection[];
  userPubkey: string;
  relays?: string[];
  webUrls?: string[];
  maintainers?: string[];
  community?: RepoCommunityBinding;
  onPublishEvent?: PublishRepoEvent;
  onFetchRelayEvents?: FetchRelayEvents;
  updateProgress: (message: string) => void;
  runAbortable: <T>(operation: () => Promise<T>, label: string, timeoutMs: number) => Promise<T>;
  throwIfAborted?: () => void;
  withRateLimit?: <T>(provider: string, method: string, operation: () => Promise<T>) => Promise<T>;
  latestRepoMetadataCreatedAt?: number;
  onLatestRepoMetadataCreatedAt?: (value: number) => void;
  requireNonGraspSuccessBeforeGrasp?: boolean;
  allowApiBranchFastPath?: boolean;
  graspFirst?: boolean;
  prepublishedAnnouncement?: NostrEvent;
  prepublishedAnnouncementByGraspRelay?: Record<string, NostrEvent>;
  preprovisionedGraspRelayUrls?: string[];
  operationId?: string;
  onOperationProgress?: (event: GitOperationProgressEvent) => void;
  createWorkerOperationId?: (operation: WorkerMutationOperation) => string;
  onWorkerOperationStart?: RemoteSyncWorkerOperationCallback;
  onWorkerOperationSettled?: RemoteSyncWorkerOperationCallback;
  waitForWorkerOperationTerminal?: (
    operationId: string,
    operation: WorkerMutationOperation
  ) => Promise<OperationStatus>;
  onCheckpoint?: RemoteSyncCheckpointCallback;
  onTargetSettled?: RemoteSyncTargetSettledCallback;
}

export interface PublishRepoSyncAnnouncementOptions {
  repoName: string;
  repoDescription?: string;
  userPubkey: string;
  targets: RemoteTargetSelection[];
  relayUrls: string[];
  sourceCloneUrls?: string[];
  sourceWebUrls?: string[];
  community?: RepoCommunityBinding;
  onPublishEvent: PublishRepoEvent;
  onFetchRelayEvents?: FetchRelayEvents;
  updateProgress: (message: string) => void;
  runAbortable: <T>(operation: () => Promise<T>, label: string, timeoutMs: number) => Promise<T>;
  maxAnnouncementPublishAttempts?: number;
  announcementRetryDelayMs?: number;
}

export interface RepoSyncAnnouncementAdmission {
  announcementEvent: NostrEvent;
  ackedRelayUrls: string[];
  graspRelayUrls: string[];
  announcementByGraspRelay: Record<string, NostrEvent>;
  latestAnnouncementCreatedAt: number;
}

function normalizeRelayForAdmission(relayUrl: string): string {
  return relayUrl.trim().replace(/\/+$/, "").toLowerCase();
}

export async function publishRepoSyncAnnouncement({
  repoName,
  repoDescription = "",
  userPubkey,
  targets,
  relayUrls,
  sourceCloneUrls = [],
  sourceWebUrls = [],
  community,
  onPublishEvent,
  onFetchRelayEvents,
  updateProgress,
  runAbortable,
  maxAnnouncementPublishAttempts = 3,
  announcementRetryDelayMs = 500,
}: PublishRepoSyncAnnouncementOptions): Promise<RepoSyncAnnouncementAdmission> {
  const allGraspTargets = targets.filter(
    (target) => target.provider === "grasp" && target.relayUrl
  );
  const allGraspRelayUrls = sanitizeRelays(
    allGraspTargets.map((target) => normalizeGraspOrigins(target.relayUrl as string).wsOrigin)
  );
  const newGraspRelayUrls = sanitizeRelays(
    targets
      .filter(
        (target) => target.provider === "grasp" && target.relayUrl && !target.existingRemoteUrl
      )
      .map((target) => normalizeGraspOrigins(target.relayUrl as string).wsOrigin)
  );
  const existingGraspRelayUrls = sanitizeRelays(
    targets
      .filter(
        (target) => target.provider === "grasp" && target.relayUrl && target.existingRemoteUrl
      )
      .map((target) => normalizeGraspOrigins(target.relayUrl as string).wsOrigin)
  );
  const selectedGraspRelaySet = new Set(allGraspRelayUrls.map(normalizeRelayForAdmission));
  const genericRelayUrls = sanitizeRelays(relayUrls).filter(
    (relayUrl) => !selectedGraspRelaySet.has(normalizeRelayForAdmission(relayUrl))
  );
  const candidateRelays = sanitizeRelays([...genericRelayUrls, ...newGraspRelayUrls]);
  if (candidateRelays.length === 0 && existingGraspRelayUrls.length === 0) {
    throw new Error("Repository announcement requires at least one relay");
  }

  const graspUrls = buildGraspRepoUrls({
    relayUrls: allGraspRelayUrls,
    ownerPubkey: userPubkey,
    repoName,
  });
  const announcementEvent = allGraspRelayUrls[0]
    ? createGraspAnnouncementAndState({
        relayUrl: allGraspRelayUrls[0],
        ownerPubkey: userPubkey,
        repoName,
        description: repoDescription,
        relays: candidateRelays,
        cloneUrls: graspUrls.cloneUrls,
        webUrls: graspUrls.webUrls,
        community,
      }).announcementEvent
    : createRepoAnnouncementEvent({
        repoId: repoName,
        name: repoName,
        description: repoDescription,
        relays: candidateRelays,
        clone: sourceCloneUrls.filter(Boolean),
        web: sourceWebUrls.filter(Boolean),
        community,
      });

  const announcementByGraspRelay: Record<string, NostrEvent> = {};
  const existingAnnouncements: NostrEvent[] = [];
  for (const relayUrl of existingGraspRelayUrls) {
    if (!onFetchRelayEvents) {
      throw new Error("Existing GRASP target verification requires relay reads");
    }
    updateProgress(`Verifying existing repository announcement on ${relayUrl}...`);
    const events = await onFetchRelayEvents({
      relays: [relayUrl],
      filters: [{ kinds: [30617], authors: [userPubkey], "#d": [repoName] }],
      timeoutMs: 5000,
      throwOnTimeout: true,
    });
    const existingAnnouncement = events
      .filter(
        (event) =>
          event.kind === 30617 &&
          event.pubkey === userPubkey &&
          event.tags.some((tag) => tag[0] === "d" && tag[1] === repoName)
      )
      .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
    if (!existingAnnouncement) {
      throw new Error(
        `Existing GRASP target has no queryable repository announcement: ${relayUrl}`
      );
    }
    announcementByGraspRelay[normalizeRelayForAdmission(relayUrl)] = existingAnnouncement;
    existingAnnouncements.push(existingAnnouncement);
  }

  let signedAnnouncement: NostrEvent | undefined;
  let ackedRelayUrls: string[] = [];
  if (candidateRelays.length > 0) {
    const attempts = Math.max(1, Math.floor(maxAnnouncementPublishAttempts));
    const ackedRelaySet = new Set<string>();
    const relayOutcomes = new Map<
      string,
      { relay: string; status: string; detail: string }
    >();
    let pendingRelays = [...candidateRelays];

    for (let attempt = 1; attempt <= attempts && pendingRelays.length > 0; attempt++) {
      updateProgress(
        attempt === 1
          ? "Publishing repository announcement before remote sync..."
          : `Retrying repository announcement (${attempt}/${attempts})...`
      );
      const result = await onPublishEvent(signedAnnouncement || announcementEvent, {
        relays: pendingRelays,
        stage: "provisional",
      });
      if (!result?.event?.id || !result.event.sig || !result.event.pubkey) {
        throw new Error("Repository announcement publication did not return a signed event");
      }
      if (signedAnnouncement && result.event.id !== signedAnnouncement.id) {
        throw new Error("Repository announcement retry returned a different signed event");
      }
      signedAnnouncement ||= result.event;

      const ack = extractPublishRelayAck(result);
      for (const relayUrl of ack.ackedRelays) {
        ackedRelaySet.add(normalizeRelayForAdmission(relayUrl));
      }
      for (const outcome of ack.relayOutcomes || []) {
        relayOutcomes.set(normalizeRelayForAdmission(outcome.relay), outcome);
      }

      pendingRelays = pendingRelays.filter((relayUrl) => {
        const relayKey = normalizeRelayForAdmission(relayUrl);
        if (ackedRelaySet.has(relayKey)) return false;
        const status = relayOutcomes.get(relayKey)?.status.toLowerCase();
        return status !== "failure";
      });

      if (pendingRelays.length > 0 && attempt < attempts && announcementRetryDelayMs > 0) {
        await runAbortable(
          () => new Promise<void>((resolve) => setTimeout(resolve, announcementRetryDelayMs)),
          "Waiting to retry repository announcement",
          announcementRetryDelayMs + 1000
        );
      }
    }

    if (!signedAnnouncement) {
      throw new Error("Repository announcement publication did not return a signed event");
    }
    ackedRelayUrls = candidateRelays.filter((relayUrl) =>
      ackedRelaySet.has(normalizeRelayForAdmission(relayUrl))
    );
    if (ackedRelayUrls.length === 0) {
      const details = candidateRelays
        .map((relayUrl) => {
          const outcome = relayOutcomes.get(normalizeRelayForAdmission(relayUrl));
          return `${relayUrl}: ${outcome?.detail || outcome?.status || "no relay outcome"}`;
        })
        .join("; ");
      throw new Error(`No repository relay ACKed the initial announcement (${details})`);
    }

    const missingGraspRelays = newGraspRelayUrls.filter(
      (relayUrl) => !ackedRelaySet.has(normalizeRelayForAdmission(relayUrl))
    );
    if (missingGraspRelays.length > 0) {
      throw new Error(
        `Selected GRASP target relay did not ACK the initial announcement: ${missingGraspRelays.join(", ")}`
      );
    }

    for (const relayUrl of newGraspRelayUrls) {
      announcementByGraspRelay[normalizeRelayForAdmission(relayUrl)] = signedAnnouncement;
    }
  }

  for (const relayUrl of allGraspRelayUrls) {
    updateProgress(`Waiting for GRASP receive-pack on ${relayUrl}...`);
    await runAbortable(
      () =>
        waitForGraspProvisioning({
          relayUrl,
          userPubkey,
          owner: toNpubOrSelf(userPubkey),
          repoName,
          maxAttempts: 15,
          delayMs: 3000,
        }),
      `Waiting for GRASP receive-pack on ${relayUrl}`,
      0
    );
  }

  return {
    announcementEvent: signedAnnouncement || existingAnnouncements[0],
    ackedRelayUrls: sanitizeRelays([...ackedRelayUrls, ...existingGraspRelayUrls]),
    graspRelayUrls: newGraspRelayUrls,
    announcementByGraspRelay,
    latestAnnouncementCreatedAt: Math.max(
      signedAnnouncement?.created_at || 0,
      ...existingAnnouncements.map((event) => event.created_at)
    ),
  };
}

export function getRemoteSyncProvisionalEvents(
  results: RemoteSyncTargetResult[]
): RepoCreationProvisionalEvent[] {
  const eventsById = new Map<string, RepoCreationProvisionalEvent>();

  for (const result of results) {
    if (!result.relayUrl) continue;
    const events = [
      result.provisionalAnnouncementEvent,
      ...(result.provisionalStateEvents || []),
    ].filter((event): event is NostrEvent => Boolean(event?.id));

    for (const event of events) {
      const existing = eventsById.get(event.id);
      eventsById.set(event.id, {
        event,
        relayUrls: Array.from(new Set([...(existing?.relayUrls || []), result.relayUrl])),
      });
    }
  }

  return Array.from(eventsById.values());
}

export function applyReconciledGraspResults(
  results: RemoteSyncTargetResult[],
  retainedGraspCloneUrls: string[]
): RemoteSyncTargetResult[] {
  const retained = new Set(retainedGraspCloneUrls);

  return results.map((result) => {
    if (
      result.provider !== "grasp" ||
      !result.success ||
      !result.remoteUrl ||
      retained.has(result.remoteUrl)
    ) {
      return result;
    }

    return {
      ...result,
      success: false,
      outcome: "failed",
      error: "GRASP target was omitted because final repository metadata did not stabilize",
      warnings: Array.from(
        new Set([
          ...(result.warnings || []),
          "Git data was retained on the GRASP target for recovery",
        ])
      ),
    };
  });
}

interface WorkerCreateRemoteRepoResult {
  success?: boolean;
  remoteUrl?: string;
  error?: string;
}

interface WorkerPushToRemoteResult {
  success?: boolean;
  error?: string;
  reason?: string;
  details?: {
    pushedRefs?: string[];
    failedRefs?: Array<{ ref: string; error: string }>;
    warnings?: string[];
  };
}

export function assertCompleteRemoteRefPush(
  pushResult: WorkerPushToRemoteResult | undefined,
  refs: string[],
  targetLabel: string
): void {
  const pushedRefs = Array.isArray(pushResult?.details?.pushedRefs)
    ? new Set(pushResult.details.pushedRefs)
    : undefined;
  const failedRefs = Array.isArray(pushResult?.details?.failedRefs)
    ? pushResult.details.failedRefs
    : [];
  const missingRefs = pushedRefs ? refs.filter((ref) => !pushedRefs.has(ref)) : [];
  if (pushResult?.success && failedRefs.length === 0 && missingRefs.length === 0) return;

  const detail = [
    ...failedRefs.map((item) => `${item.ref || "unknown ref"}: ${item.error || "push failed"}`),
    ...(missingRefs.length > 0 ? [`missing refs: ${missingRefs.join(", ")}`] : []),
  ].join("; ");
  throw new Error(
    pushResult?.error ||
      `Failed to push all imported pull request refs to ${targetLabel}${detail ? ` (${detail})` : ""}`
  );
}

class RemotePushResultError extends Error {
  result?: WorkerPushToRemoteResult;

  constructor(message: string, result?: WorkerPushToRemoteResult) {
    super(message);
    this.name = "RemotePushResultError";
    this.result = result;
  }
}

class RemoteWorkerMutationError extends Error {
  constructor(
    error: unknown,
    readonly operationId: string,
    readonly operationStatus: OperationStatus
  ) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = "RemoteWorkerMutationError";
  }
}

function getPushResultFromError(error: unknown): WorkerPushToRemoteResult | undefined {
  if (error instanceof RemotePushResultError) return error.result;

  const causes = (error as any)?.causes;
  if (Array.isArray(causes)) {
    for (const cause of causes) {
      const result = getPushResultFromError(cause);
      if (result) return result;
    }
  }

  return undefined;
}

function addFailedRef(
  failedRefs: Array<{ ref: string; error: string }>,
  ref: string | undefined,
  error: string
): void {
  const normalizedRef = String(ref || "").trim();
  const message = String(error || "sync failed").trim() || "sync failed";
  if (!normalizedRef) return;
  if (failedRefs.some((item) => item.ref === normalizedRef)) return;
  failedRefs.push({ ref: normalizedRef, error: message });
}

function collectPushResultDetails(
  pushResult: WorkerPushToRemoteResult | undefined,
  fallbackRef: string | undefined,
  fallbackError: string | undefined,
  pushedRefsForTarget: string[],
  failedRefsForTarget: Array<{ ref: string; error: string }>,
  warningsForTarget: string[]
): string[] {
  const pushedRefs = Array.isArray(pushResult?.details?.pushedRefs)
    ? pushResult.details.pushedRefs.filter(Boolean)
    : [];
  const effectivePushedRefs =
    pushedRefs.length > 0 ? pushedRefs : pushResult?.success && fallbackRef ? [fallbackRef] : [];

  pushedRefsForTarget.push(...effectivePushedRefs);

  if (Array.isArray(pushResult?.details?.failedRefs)) {
    for (const failedRef of pushResult.details.failedRefs) {
      addFailedRef(failedRefsForTarget, failedRef.ref, failedRef.error);
    }
  }

  if (!pushResult?.success && fallbackError) {
    addFailedRef(failedRefsForTarget, fallbackRef, fallbackError);
  }

  if (Array.isArray(pushResult?.details?.warnings)) {
    warningsForTarget.push(...pushResult.details.warnings.filter(Boolean));
  }

  return effectivePushedRefs;
}

function getTargetTokens(target: RemoteTargetSelection): string[] {
  return Array.from(new Set([target.token, ...(target.tokens || [])].filter(Boolean) as string[]));
}

async function tryTargetTokens<T>(
  target: RemoteTargetSelection,
  operation: (token: string) => Promise<T>
): Promise<T> {
  const tokens = getTargetTokens(target);
  if (target.provider !== "grasp" && tokens.length === 0) {
    throw new Error("Missing token for target host");
  }

  const failures: string[] = [];
  const failureErrors: unknown[] = [];
  for (const token of tokens) {
    try {
      return await operation(token);
    } catch (error) {
      if (error instanceof RemoteSyncCheckpointInterruption) throw error;
      if (isUnknownRemoteOutcome(error)) throw error;
      failureErrors.push(error);
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length === 0) {
    throw new Error(`No usable token for ${target.label}`);
  }

  if (failures.length === 1) {
    const [failure] = failureErrors;
    throw failure instanceof Error ? failure : new Error(failures[0]);
  }

  const error = new Error(
    `All tokens failed for ${target.label}: ${Array.from(new Set(failures)).join(" | ")}`
  );
  (error as any).causes = failureErrors;
  throw error;
}

async function withRateLimit<T>(
  fn: SyncLocalRepoToTargetsOptions["withRateLimit"],
  provider: string,
  method: string,
  operation: () => Promise<T>
): Promise<T> {
  if (!fn) return await operation();
  return await fn(provider, method, operation);
}

async function waitForGitLabPushReady(
  options: Pick<SyncLocalRepoToTargetsOptions, "runAbortable" | "throwIfAborted" | "withRateLimit">,
  target: RemoteTargetSelection,
  remoteUrl: string,
  token: string
): Promise<void> {
  let parsedRemote: ReturnType<typeof parseRepoUrl>;
  try {
    parsedRemote = parseRepoUrl(remoteUrl);
  } catch {
    return;
  }

  const api = getGitServiceApiFromUrl(remoteUrl, token);
  const delays = [1200, 2200, 3500];
  let lastError: unknown = null;

  for (let attempt = 0; attempt < delays.length; attempt++) {
    options.throwIfAborted?.();

    try {
      await withRateLimit(options.withRateLimit, target.provider, "GET", () =>
        api.getRepo(parsedRemote.owner, parsedRemote.repo)
      );
      return;
    } catch (error) {
      lastError = error;
      await options.runAbortable(
        () => new Promise<void>((resolve) => setTimeout(resolve, delays[attempt])),
        `Waiting for ${target.label} to be ready`,
        0
      );
    }
  }

  if (lastError) {
    throw lastError;
  }
}

export function guessWebUrl(remoteUrl: string | undefined): string | undefined {
  if (!remoteUrl) return undefined;
  if (/^wss?:\/\//i.test(remoteUrl)) {
    return remoteUrl
      .replace(/^wss:\/\//i, "https://")
      .replace(/^ws:\/\//i, "http://")
      .replace(/\.git$/, "");
  }
  return remoteUrl.replace(/\.git$/, "");
}

function sortRefs(refs: RemoteSyncRef[], defaultBranch: string): RemoteSyncRef[] {
  const seen = new Set<string>();
  const deduped = refs.filter((ref) => {
    const key = `${ref.ref}:${ref.commit || ""}`;
    if (!ref.ref || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [...deduped].sort((a, b) => {
    const rank = (item: RemoteSyncRef) => {
      if (item.type === "heads" && item.name === defaultBranch) return 0;
      if (item.type === "heads") return 1;
      return 2;
    };

    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name);
  });
}

async function resolveRequestedRefs(
  workerApi: any,
  localRepoId: string,
  refs: RemoteSyncRef[]
): Promise<RemoteSyncRef[]> {
  return await Promise.all(
    refs.map(async (ref) => {
      if (ref.commit || !workerApi?.resolveRef) return ref;

      try {
        const commit = String(
          (await workerApi.resolveRef({ repoId: localRepoId, ref: ref.ref })) || ""
        ).trim();
        return commit ? { ...ref, commit } : ref;
      } catch {
        return ref;
      }
    })
  );
}

async function verifyRequestedRemoteRefs(params: {
  workerApi: any;
  remoteUrl: string;
  refs: RemoteSyncRef[];
}): Promise<string[]> {
  if (!params.workerApi?.listServerRefs) {
    throw new Error("Remote ref postflight verification is unavailable");
  }

  const advertisedRefs = (await params.workerApi.listServerRefs({
    url: params.remoteUrl,
    symrefs: true,
  })) as Array<{ ref?: string; oid?: string }>;
  const advertisedByRef = new Map(
    (advertisedRefs || []).map((ref) => [String(ref.ref || ""), String(ref.oid || "")])
  );
  const mismatches = params.refs.filter((ref) => {
    if (!ref.commit) return true;
    if (advertisedByRef.get(ref.ref) === ref.commit) return false;
    return ref.type !== "tags" || advertisedByRef.get(`${ref.ref}^{}`) !== ref.commit;
  });

  if (mismatches.length > 0) {
    throw new Error(
      `Remote ref postflight verification failed: ${mismatches.map((ref) => ref.ref).join(", ")}`
    );
  }

  return params.refs.map((ref) => ref.ref);
}

function updateLatestRepoMetadataCreatedAt(
  current: number,
  onUpdate: SyncLocalRepoToTargetsOptions["onLatestRepoMetadataCreatedAt"],
  ...events: Array<{ created_at?: number } | null | undefined>
): number {
  const next = trackLatestRepoMetadataCreatedAt(current, ...events);
  onUpdate?.(next);
  return next;
}

function isUnknownRemoteOutcome(error: unknown): boolean {
  if (error instanceof RemoteWorkerMutationError && error.operationStatus.state === "unknown") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error || "");
  return /abort|cancel|timed?\s*out|timeout|network|failed to fetch|connection.*(?:closed|reset)/i.test(
    message
  );
}

class RemoteSyncCheckpointInterruption extends Error {
  constructor(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    super(`Remote sync checkpoint failed: ${message}`, { cause: error });
    this.name = "RemoteSyncCheckpointInterruption";
  }
}

function getCheckpointTarget(target: RemoteTargetSelection): RemoteSyncCheckpoint["target"] {
  return {
    id: target.id,
    label: target.label,
    provider: target.provider,
    ...(target.host ? { host: target.host } : {}),
    ...(target.relayUrl ? { relayUrl: target.relayUrl } : {}),
  };
}

function sanitizeCheckpointError(error: unknown, target: RemoteTargetSelection): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const token of getTargetTokens(target)) {
    message = message.split(token).join("[REDACTED]");
    message = message.split(encodeURIComponent(token)).join("[REDACTED]");
  }
  return message;
}

async function emitCheckpoint(
  callback: RemoteSyncCheckpointCallback | undefined,
  checkpoint: RemoteSyncCheckpoint
): Promise<void> {
  if (!callback) return;
  try {
    await callback(checkpoint);
  } catch (error) {
    if (error instanceof RemoteSyncCheckpointInterruption) throw error;
    throw new RemoteSyncCheckpointInterruption(error);
  }
}

async function emitTargetSettled(
  callback: RemoteSyncTargetSettledCallback | undefined,
  result: RemoteSyncTargetResult
): Promise<void> {
  if (!callback) return;
  try {
    await callback(result);
  } catch (error) {
    if (error instanceof RemoteSyncCheckpointInterruption) throw error;
    throw new RemoteSyncCheckpointInterruption(error);
  }
}

async function cleanupEmptyCreatedRemote(params: {
  workerApi: any;
  target: RemoteTargetSelection;
  remoteUrl: string;
  token?: string;
  beforeDelete?: () => Promise<void>;
  afterDelete?: (cleanup: NonNullable<RemoteSyncTargetResult["cleanup"]>) => Promise<void>;
  runWorkerMutation: <T>(
    operation: WorkerMutationOperation,
    callback: (operationId: string) => Promise<T>,
    label: string,
    timeoutMs: number
  ) => Promise<{ result: T; operationId: string }>;
  waitForMutationTerminal: (
    operationId: string,
    operation: WorkerMutationOperation
  ) => Promise<OperationStatus>;
}): Promise<RemoteSyncTargetResult["cleanup"]> {
  if (!params.token || !params.workerApi?.listServerRefs || !params.workerApi?.deleteRemoteRepo) {
    return { attempted: false, success: false, error: "Remote emptiness could not be verified" };
  }

  let deleteStarted = false;
  try {
    const refs = (await params.workerApi.listServerRefs({
      url: params.remoteUrl,
      symrefs: true,
    })) as Array<{ ref?: string; oid?: string }>;
    const populatedRefs = (refs || []).filter(
      (ref) =>
        (String(ref?.ref || "").startsWith("refs/heads/") ||
          String(ref?.ref || "").startsWith("refs/tags/")) &&
        Boolean(ref?.oid)
    );

    if (populatedRefs.length > 0) {
      return {
        attempted: false,
        success: false,
        error: "Remote contains pushed refs and was retained for recovery",
      };
    }

    await params.beforeDelete?.();
    deleteStarted = true;
    const mutation = await params.runWorkerMutation<any>(
      "deleteRemoteRepo",
      (operationId) =>
        params.workerApi.deleteRemoteRepo({
          remoteUrl: params.remoteUrl,
          token: params.token,
          provider: params.target.provider,
          baseUrl: getProviderBaseUrl(params.target.provider, params.target.host),
          operationId,
        }),
      `Deleting empty remote repository on ${params.target.label}`,
      45000
    );
    const result = mutation.result;
    const terminalStatus = !result?.success
      ? await params.waitForMutationTerminal(mutation.operationId, "deleteRemoteRepo")
      : undefined;

    const cleanup = result?.success
      ? { attempted: true, success: true }
      : {
          attempted: true,
          success: false,
          ...(terminalStatus?.state === "unknown" ? { unknown: true } : {}),
          error: result?.error || "Provider repository deletion failed",
        };
    await params.afterDelete?.(cleanup);
    return cleanup;
  } catch (error) {
    if (error instanceof RemoteSyncCheckpointInterruption) throw error;
    const unknown = isUnknownRemoteOutcome(error);
    const cleanup = {
      attempted: deleteStarted,
      success: false,
      ...(unknown ? { unknown: true } : {}),
      error: `Remote emptiness could not be verified: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
    if (deleteStarted) await params.afterDelete?.(cleanup);
    return cleanup;
  }
}

export async function syncLocalRepoToTargets(
  options: SyncLocalRepoToTargetsOptions
): Promise<RemoteSyncTargetResult[]> {
  const {
    workerApi,
    localRepoId,
    repoName,
    repoDescription,
    defaultBranch,
    targets,
    userPubkey,
    relays = [],
    webUrls: configuredWebUrls = [],
    maintainers,
    community,
    onPublishEvent,
    updateProgress,
    runAbortable,
    throwIfAborted,
    withRateLimit: rateLimiter,
    requireNonGraspSuccessBeforeGrasp = false,
    graspFirst = true,
    prepublishedAnnouncement,
    prepublishedAnnouncementByGraspRelay = {},
    preprovisionedGraspRelayUrls = [],
    operationId,
    onOperationProgress,
    onWorkerOperationStart,
    onWorkerOperationSettled,
    onCheckpoint,
    onTargetSettled,
  } = options;
  const fallbackWorkerOperationId = createWorkerOperationIdFactory(
    operationId || `remote-sync:${Date.now()}`
  );
  const createWorkerOperationId = options.createWorkerOperationId || fallbackWorkerOperationId;
  const waitForMutationTerminal = async (
    mutationOperationId: string,
    operation: WorkerMutationOperation
  ): Promise<OperationStatus> =>
    options.waitForWorkerOperationTerminal
      ? await options.waitForWorkerOperationTerminal(mutationOperationId, operation)
      : await waitForWorkerOperationTerminal(workerApi, mutationOperationId, operation);
  const runWorkerMutation = async <T>(
    operation: WorkerMutationOperation,
    callback: (mutationOperationId: string) => Promise<T>,
    label: string,
    timeoutMs: number
  ): Promise<{ result: T; operationId: string }> => {
    const mutationOperationId = createWorkerOperationId(operation);
    try {
      const result = await runAbortable(
        async () => {
          await onWorkerOperationStart?.(mutationOperationId, operation);
          try {
            return await callback(mutationOperationId);
          } finally {
            await onWorkerOperationSettled?.(mutationOperationId, operation);
          }
        },
        label,
        timeoutMs
      );
      return { result, operationId: mutationOperationId };
    } catch (error) {
      const status = await waitForMutationTerminal(mutationOperationId, operation);
      throw new RemoteWorkerMutationError(error, mutationOperationId, status);
    }
  };
  const webUrls = Array.from(
    new Set(configuredWebUrls.map((url) => String(url || "").trim()).filter(Boolean))
  );

  if (!targets.length) return [];

  const settleImmediateResults = async (
    immediateResults: RemoteSyncTargetResult[]
  ): Promise<RemoteSyncTargetResult[]> => {
    for (const result of immediateResults) {
      const target = targets.find((item) => item.id === result.id);
      if (target) {
        await emitCheckpoint(onCheckpoint, {
          action: "target",
          position: "after",
          target: getCheckpointTarget(target),
          stage: result.outcome === "unknown" ? "unknown" : "failed",
          error: result.error,
          refs: options.refs.map((ref) => ({
            ref: ref.ref,
            ...(ref.commit ? { commit: ref.commit } : {}),
            stage: "planned",
          })),
        });
      }
      await emitTargetSettled(onTargetSettled, result);
    }
    return immediateResults;
  };

  if (!workerApi) {
    return await settleImmediateResults(
      targets.map((target) => ({
        id: target.id,
        label: target.label,
        provider: target.provider,
        success: false,
        outcome: "failed",
        error: "Git worker unavailable for remote sync",
      }))
    );
  }

  const orderedRefs = await resolveRequestedRefs(
    workerApi,
    localRepoId,
    sortRefs(options.refs, defaultBranch)
  );
  if (orderedRefs.length === 0) {
    return await settleImmediateResults(
      targets.map((target) => ({
        id: target.id,
        label: target.label,
        provider: target.provider,
        success: false,
        outcome: "failed",
        error: "No git refs available for remote sync",
      }))
    );
  }
  const unresolvedRef = orderedRefs.find((ref) => !ref.commit);
  if (unresolvedRef) {
    return await settleImmediateResults(
      targets.map((target) => ({
        id: target.id,
        label: target.label,
        provider: target.provider,
        success: false,
        outcome: "failed",
        error: `Cannot verify ${unresolvedRef.ref} without a resolved commit`,
      }))
    );
  }

  const orderedTargets = [...targets].sort((a, b) => {
    const aIsGrasp = a.provider === "grasp" ? 1 : 0;
    const bIsGrasp = b.provider === "grasp" ? 1 : 0;
    if (graspFirst) return bIsGrasp - aIsGrasp;
    return aIsGrasp - bIsGrasp;
  });
  const hasAnyNonGraspTarget = orderedTargets.some((target) => target.provider !== "grasp");
  const selectedGraspCloneUrls = buildGraspRepoUrls({
    relayUrls: orderedTargets
      .filter((target) => target.provider === "grasp" && target.relayUrl)
      .map((target) => target.relayUrl as string),
    ownerPubkey: userPubkey,
    repoName,
  }).cloneUrls;
  const selectedGraspRelayUrls = orderedTargets
    .filter((target) => target.provider === "grasp" && target.relayUrl)
    .map((target) => normalizeGraspOrigins(target.relayUrl as string).wsOrigin);
  const canonicalGraspRelays = Array.from(new Set([...selectedGraspRelayUrls, ...relays]));
  const canonicalGraspEvents = selectedGraspRelayUrls[0]
    ? createGraspAnnouncementAndState({
        relayUrl: selectedGraspRelayUrls[0],
        ownerPubkey: userPubkey,
        repoName,
        description: repoDescription,
        relays: canonicalGraspRelays,
        cloneUrls: selectedGraspCloneUrls,
        webUrls: webUrls.length > 0 ? webUrls : undefined,
        maintainers,
        community,
      })
    : undefined;
  let canonicalSignedAnnouncement: NostrEvent | undefined = prepublishedAnnouncement;
  const preprovisionedGraspRelays = new Set(
    preprovisionedGraspRelayUrls.map((relayUrl) =>
      normalizeRelayForAdmission(normalizeGraspOrigins(relayUrl).wsOrigin)
    )
  );

  const results: RemoteSyncTargetResult[] = [];
  let latestRepoMetadataCreatedAt = options.latestRepoMetadataCreatedAt || 0;
  const settleTarget = async (
    target: RemoteTargetSelection,
    result: RemoteSyncTargetResult
  ): Promise<void> => {
    results.push(result);
    const failedRefs = new Map((result.failedRefs || []).map((item) => [item.ref, item.error]));
    const pushedRefs = new Set(result.pushedRefs || []);
    await emitCheckpoint(onCheckpoint, {
      action: "target",
      position: "after",
      target: getCheckpointTarget(target),
      stage: result.success ? "verified" : result.outcome === "unknown" ? "unknown" : "failed",
      ...(result.remoteUrl ? { remoteUrl: result.remoteUrl } : {}),
      ...(result.webUrl ? { webUrl: result.webUrl } : {}),
      ...(result.createdRemote !== undefined ? { createdRemote: result.createdRemote } : {}),
      ...(result.cleanup ? { cleanup: result.cleanup } : {}),
      ...(result.error ? { error: sanitizeCheckpointError(result.error, target) } : {}),
      refs: orderedRefs.map((ref) => ({
        ref: ref.ref,
        ...(ref.commit ? { commit: ref.commit } : {}),
        stage: failedRefs.has(ref.ref)
          ? result.outcome === "unknown"
            ? "unknown"
            : "failed"
          : result.success
            ? "verified"
            : pushedRefs.has(ref.ref)
              ? "pushed"
              : result.outcome === "unknown"
                ? "unknown"
                : "planned",
        ...(failedRefs.has(ref.ref)
          ? { error: sanitizeCheckpointError(failedRefs.get(ref.ref), target) }
          : {}),
      })),
    });
    await emitTargetSettled(onTargetSettled, result);
  };
  const verifyTargetRefs = async (
    target: RemoteTargetSelection,
    remoteUrl: string
  ): Promise<string[]> => {
    await emitCheckpoint(onCheckpoint, {
      action: "verify",
      position: "before",
      target: getCheckpointTarget(target),
      stage: "pushing",
      remoteUrl,
    });
    let verifiedRefs: string[];
    try {
      verifiedRefs = await verifyRequestedRemoteRefs({ workerApi, remoteUrl, refs: orderedRefs });
    } catch (error) {
      const stage = isUnknownRemoteOutcome(error) ? "unknown" : "failed";
      await emitCheckpoint(onCheckpoint, {
        action: "verify",
        position: "after",
        target: getCheckpointTarget(target),
        stage,
        remoteUrl,
        error: sanitizeCheckpointError(error, target),
        refs: orderedRefs.map((ref) => ({
          ref: ref.ref,
          ...(ref.commit ? { commit: ref.commit } : {}),
          stage,
          error: sanitizeCheckpointError(error, target),
        })),
      });
      throw error;
    }
    for (const ref of orderedRefs) {
      await emitCheckpoint(onCheckpoint, {
        action: "verify",
        position: "after",
        target: getCheckpointTarget(target),
        stage: "verified",
        remoteUrl,
        ref: {
          ref: ref.ref,
          ...(ref.commit ? { commit: ref.commit } : {}),
          stage: "verified",
        },
      });
    }
    return verifiedRefs;
  };
  const emitOperationProgress = (
    phase: string,
    progress: Partial<
      Pick<GitOperationProgressEvent, "loaded" | "total" | "unit" | "target" | "ref">
    > = {}
  ) => {
    if (!operationId || !onOperationProgress) return;
    onOperationProgress({
      type: "git-progress",
      operationId,
      repoId: localRepoId,
      operation: "remote-sync",
      phase,
      ...progress,
    });
  };

  emitOperationProgress("Preparing remote synchronization", {
    loaded: 0,
    total: orderedTargets.length,
    unit: "targets",
  });

  for (let i = 0; i < orderedTargets.length; i++) {
    const target = orderedTargets[i];
    emitOperationProgress("Syncing target", {
      loaded: i,
      total: orderedTargets.length,
      unit: "targets",
      target: target.label,
    });

    let remoteUrl = target.existingRemoteUrl;
    let webUrl = target.existingWebUrl;
    let createdRemote = false;
    const pushedRefsForTarget: string[] = [];
    const failedRefsForTarget: Array<{ ref: string; error: string }> = [];
    const warningsForTarget: string[] = [];
    let activeRef: RemoteSyncRef | null = null;
    let provisionToken = getTargetTokens(target)[0];
    const provisionalStateEvents: NostrEvent[] = [];
    let targetSignedAnnouncement = target.relayUrl
      ? prepublishedAnnouncementByGraspRelay[
          normalizeRelayForAdmission(normalizeGraspOrigins(target.relayUrl).wsOrigin)
        ] || canonicalSignedAnnouncement
      : canonicalSignedAnnouncement;

    await emitCheckpoint(onCheckpoint, {
      action: "target",
      position: "before",
      target: getCheckpointTarget(target),
      stage: "planned",
      ...(remoteUrl ? { remoteUrl } : {}),
      ...(webUrl ? { webUrl } : {}),
      createdRemote: false,
      refs: orderedRefs.map((ref) => ({
        ref: ref.ref,
        ...(ref.commit ? { commit: ref.commit } : {}),
        stage: "planned",
      })),
    });

    try {
      throwIfAborted?.();
      updateProgress(`Syncing target ${i + 1}/${orderedTargets.length}: ${target.label}`);
      if (target.provider === "grasp") {
        if (!target.relayUrl) {
          throw new Error("Missing relay URL");
        }
        if (!onPublishEvent) {
          throw new Error("Missing onPublishEvent callback required for GRASP sync");
        }
        if (!options.onFetchRelayEvents) {
          throw new Error("Missing onFetchRelayEvents callback required for GRASP sync");
        }
        const hasSuccessfulNonGraspPush = results.some(
          (result) => result.success && result.provider !== "grasp"
        );
        if (
          !remoteUrl &&
          requireNonGraspSuccessBeforeGrasp &&
          hasAnyNonGraspTarget &&
          !hasSuccessfulNonGraspPush
        ) {
          throw new Error(
            "Skipping GRASP repo-event provisioning because no non-GRASP target succeeded"
          );
        }

        if (!remoteUrl) {
          createdRemote = true;
          const targetRelayUrl = normalizeGraspOrigins(target.relayUrl).wsOrigin;
          const wasPreprovisioned = preprovisionedGraspRelays.has(
            normalizeRelayForAdmission(targetRelayUrl)
          );
          const targetUrls = buildGraspRepoUrls({
            relayUrls: [target.relayUrl],
            ownerPubkey: userPubkey,
            repoName,
          });
          remoteUrl = targetUrls.cloneUrls[0];
          webUrl = targetUrls.webUrls[0] || guessWebUrl(remoteUrl);
          if (!remoteUrl) {
            throw new Error(`Could not derive GRASP Smart HTTP URL for ${target.label}`);
          }
          const graspEvents =
            canonicalGraspEvents ||
            createGraspAnnouncementAndState({
              relayUrl: target.relayUrl,
              ownerPubkey: userPubkey,
              repoName,
              description: repoDescription,
              relays: canonicalGraspRelays,
              cloneUrls: [remoteUrl],
              webUrls: webUrls.length > 0 ? webUrls : webUrl ? [webUrl] : undefined,
              maintainers,
              community,
            });

          latestRepoMetadataCreatedAt = updateLatestRepoMetadataCreatedAt(
            latestRepoMetadataCreatedAt,
            options.onLatestRepoMetadataCreatedAt,
            targetSignedAnnouncement || graspEvents.announcementEvent,
            graspEvents.stateEvent
          );

          if (!wasPreprovisioned) {
            updateProgress(`Publishing repository announcement to ${target.label}...`);
            await emitCheckpoint(onCheckpoint, {
              action: "publish",
              position: "before",
              target: getCheckpointTarget(target),
              stage: "creating",
              remoteUrl,
              webUrl,
              createdRemote: true,
            });
            let publishedAnnouncement: Awaited<ReturnType<typeof publishGraspEventWithRetry>>;
            try {
              publishedAnnouncement = await publishGraspEventWithRetry({
                relayUrl: target.relayUrl,
                event: targetSignedAnnouncement || graspEvents.announcementEvent,
                onPublishEvent,
                publishRelays: [targetRelayUrl],
              });
            } catch (error) {
              await emitCheckpoint(onCheckpoint, {
                action: "publish",
                position: "after",
                target: getCheckpointTarget(target),
                stage: isUnknownRemoteOutcome(error) ? "unknown" : "failed",
                remoteUrl,
                webUrl,
                createdRemote: true,
                error: sanitizeCheckpointError(error, target),
              });
              throw error;
            }
            await emitCheckpoint(onCheckpoint, {
              action: "publish",
              position: "after",
              target: getCheckpointTarget(target),
              stage: "created",
              remoteUrl,
              webUrl,
              createdRemote: true,
            });
            canonicalSignedAnnouncement = publishedAnnouncement.event;
            targetSignedAnnouncement = publishedAnnouncement.event;

            await runAbortable(
              () =>
                waitForGraspProvisioning({
                  relayUrl: target.relayUrl!,
                  userPubkey,
                  owner: toNpubOrSelf(userPubkey),
                  repoName,
                  maxAttempts: 15,
                  delayMs: 3000,
                }),
              `Waiting for GRASP receive-pack on ${target.label}`,
              0
            );
          } else {
            await emitCheckpoint(onCheckpoint, {
              action: "create",
              position: "after",
              target: getCheckpointTarget(target),
              stage: "created",
              remoteUrl,
              webUrl,
              createdRemote: true,
            });
          }
        }

        if (!remoteUrl) {
          throw new Error("No GRASP remote URL available for push");
        }
        const graspRemoteUrl = remoteUrl;

        const refDetailsByFullRef = new Map(
          orderedRefs
            .filter((item) => Boolean(item.commit))
            .map((item) => [
              item.ref,
              { type: item.type, name: item.name, commit: item.commit as string },
            ])
        );
        let stateRefsByFullRef = new Map<string, GraspRef>();
        let currentStateHead: string | undefined;
        let latestStateCreatedAt = 0;
        let announcementVerified = false;

        try {
          const existingStateEvent = await fetchLatestGraspRepoStateEvent({
            relayUrl: target.relayUrl,
            repoName,
            fetchRelayEvents: options.onFetchRelayEvents,
            authorPubkey: userPubkey,
          });
          if (!existingStateEvent && !createdRemote) {
            throw new Error("Existing GRASP repository state is unavailable");
          }
          stateRefsByFullRef = createGraspRefMap(getGraspStateRefsFromEvent(existingStateEvent));
          currentStateHead = getGraspStateHeadFromEvent(existingStateEvent);
          latestStateCreatedAt = existingStateEvent?.created_at || 0;
        } catch (stateFetchError) {
          if (!createdRemote) throw stateFetchError;
          if (createdRemote) {
            console.warn(
              "[GRASP] Failed to fetch existing repo state before sync:",
              stateFetchError
            );
          }
        }

        for (let refIndex = 0; refIndex < orderedRefs.length; refIndex++) {
          const ref = orderedRefs[refIndex];
          activeRef = ref;
          throwIfAborted?.();
          let publishedStateEvent: NostrEvent | undefined;
          let nextStateHead = currentStateHead;

          if (refDetailsByFullRef.size > 0) {
            const refDetail = refDetailsByFullRef.get(ref.ref);
            updateProgress(
              `Publishing GRASP state for ${ref.type === "heads" ? "branch" : "tag"} ${ref.name} (${refIndex + 1}/${orderedRefs.length})...`
            );

            const stateRefs = refDetail
              ? mergeGraspRefs(Array.from(stateRefsByFullRef.values()), [refDetail])
              : Array.from(stateRefsByFullRef.values());

            if (stateRefs.length > 0) {
              const stateHead = resolveGraspStateHead({
                existingHead: currentStateHead,
                refs: stateRefs,
                fallbackHead: defaultBranch,
                preferFallback: ref.type === "heads" && ref.name === defaultBranch,
              });

              const graspState = createGraspAnnouncementAndState({
                relayUrl: target.relayUrl,
                ownerPubkey: userPubkey,
                repoName,
                description: repoDescription,
                relays: Array.from(
                  new Set([normalizeGraspOrigins(target.relayUrl).wsOrigin, ...relays])
                ),
                cloneUrls:
                  selectedGraspCloneUrls.length > 0 ? selectedGraspCloneUrls : [graspRemoteUrl],
                webUrls:
                  webUrls.length > 0
                    ? webUrls
                    : [
                        webUrl ||
                          guessWebUrl(graspRemoteUrl) ||
                          graspRemoteUrl.replace(/\.git$/, ""),
                      ],
                maintainers,
                community,
                refs: stateRefs,
                head: stateHead,
              });
              const stateEvent =
                graspState.stateEvent.created_at <= latestStateCreatedAt
                  ? { ...graspState.stateEvent, created_at: latestStateCreatedAt + 1 }
                  : graspState.stateEvent;
              latestStateCreatedAt = stateEvent.created_at;

              latestRepoMetadataCreatedAt = updateLatestRepoMetadataCreatedAt(
                latestRepoMetadataCreatedAt,
                options.onLatestRepoMetadataCreatedAt,
                graspState.announcementEvent,
                stateEvent
              );

              await emitCheckpoint(onCheckpoint, {
                action: "publish",
                position: "before",
                target: getCheckpointTarget(target),
                stage: "created",
                remoteUrl: graspRemoteUrl,
                createdRemote,
                ref: {
                  ref: ref.ref,
                  ...(ref.commit ? { commit: ref.commit } : {}),
                  stage: "planned",
                },
              });
              let publishedState: Awaited<ReturnType<typeof publishGraspEventWithRetry>>;
              try {
                publishedState = await runAbortable(
                  () =>
                    publishGraspEventWithRetry({
                      relayUrl: target.relayUrl!,
                      event: stateEvent,
                      onPublishEvent,
                      publishRelays: [normalizeGraspOrigins(target.relayUrl!).wsOrigin],
                    }),
                  `Publishing GRASP state for ${ref.name}`,
                  0
                );
              } catch (error) {
                const stage = isUnknownRemoteOutcome(error) ? "unknown" : "failed";
                await emitCheckpoint(onCheckpoint, {
                  action: "publish",
                  position: "after",
                  target: getCheckpointTarget(target),
                  stage,
                  remoteUrl: graspRemoteUrl,
                  createdRemote,
                  error: sanitizeCheckpointError(error, target),
                  ref: {
                    ref: ref.ref,
                    ...(ref.commit ? { commit: ref.commit } : {}),
                    stage,
                    error: sanitizeCheckpointError(error, target),
                  },
                });
                throw error;
              }
              await emitCheckpoint(onCheckpoint, {
                action: "publish",
                position: "after",
                target: getCheckpointTarget(target),
                stage: "created",
                remoteUrl: graspRemoteUrl,
                createdRemote,
                ref: {
                  ref: ref.ref,
                  ...(ref.commit ? { commit: ref.commit } : {}),
                  stage: "planned",
                },
              });
              publishedStateEvent = publishedState.event;
              provisionalStateEvents.push(publishedState.event);
              nextStateHead = stateHead;
            }
          }

          updateProgress(
            `Pushing ${ref.type === "heads" ? "branch" : "tag"} ${ref.name} to ${target.label} (${refIndex + 1}/${orderedRefs.length})...`
          );
          emitOperationProgress("Preparing ref push", {
            loaded: refIndex,
            total: orderedRefs.length,
            unit: "refs",
            target: target.label,
            ref: ref.ref,
          });

          await emitCheckpoint(onCheckpoint, {
            action: "push",
            position: "before",
            target: getCheckpointTarget(target),
            stage: "pushing",
            remoteUrl: graspRemoteUrl,
            createdRemote,
            ref: {
              ref: ref.ref,
              ...(ref.commit ? { commit: ref.commit } : {}),
              stage: "pushing",
            },
          });
          let pushResult: WorkerPushToRemoteResult;
          try {
            const mutation = await runWorkerMutation<WorkerPushToRemoteResult>(
              "pushToRemote",
              (mutationOperationId) =>
                workerApi.pushToRemote({
                  repoId: localRepoId,
                  remoteUrl: graspRemoteUrl,
                  branch: defaultBranch,
                  ref: ref.ref,
                  token: userPubkey,
                  provider: "grasp",
                  operationId: mutationOperationId,
                }),
              `Pushing ${ref.name} to ${target.label}`,
              0
            );
            pushResult = mutation.result;
            if (!pushResult?.success) {
              const status = await waitForMutationTerminal(mutation.operationId, "pushToRemote");
              if (status.state === "unknown") {
                throw new RemoteWorkerMutationError(
                  pushResult?.error || `Failed to push ${ref.name} to GRASP target`,
                  mutation.operationId,
                  status
                );
              }
            }
          } catch (error) {
            const stage = isUnknownRemoteOutcome(error) ? "unknown" : "failed";
            await emitCheckpoint(onCheckpoint, {
              action: "push",
              position: "after",
              target: getCheckpointTarget(target),
              stage,
              remoteUrl: graspRemoteUrl,
              createdRemote,
              error: sanitizeCheckpointError(error, target),
              ref: {
                ref: ref.ref,
                ...(ref.commit ? { commit: ref.commit } : {}),
                stage,
                error: sanitizeCheckpointError(error, target),
              },
            });
            throw error;
          }

          if (!pushResult?.success) {
            const message = pushResult?.error || `Failed to push ${ref.name} to GRASP target`;
            await emitCheckpoint(onCheckpoint, {
              action: "push",
              position: "after",
              target: getCheckpointTarget(target),
              stage: "failed",
              remoteUrl: graspRemoteUrl,
              createdRemote,
              error: sanitizeCheckpointError(message, target),
              ref: {
                ref: ref.ref,
                ...(ref.commit ? { commit: ref.commit } : {}),
                stage: "failed",
                error: sanitizeCheckpointError(message, target),
              },
            });
            throw new RemotePushResultError(message, pushResult);
          }

          await emitCheckpoint(onCheckpoint, {
            action: "push",
            position: "after",
            target: getCheckpointTarget(target),
            stage: "pushing",
            remoteUrl: graspRemoteUrl,
            createdRemote,
            ref: {
              ref: ref.ref,
              ...(ref.commit ? { commit: ref.commit } : {}),
              stage: "pushed",
            },
          });

          const pushedRefs = collectPushResultDetails(
            pushResult,
            ref.ref,
            undefined,
            pushedRefsForTarget,
            failedRefsForTarget,
            warningsForTarget
          );

          if (pushedRefs.includes(ref.ref)) {
            if (!publishedStateEvent) {
              throw new Error("GRASP push completed without post-push event verification support");
            }

            updateProgress(`Verifying GRASP metadata for ${ref.name} on ${target.label}...`);
            if (!announcementVerified && targetSignedAnnouncement) {
              await verifyGraspEventAfterPush({
                relayUrl: target.relayUrl,
                event: targetSignedAnnouncement,
                fetchRelayEvents: options.onFetchRelayEvents,
              });
              announcementVerified = true;
            }
            await verifyGraspEventAfterPush({
              relayUrl: target.relayUrl,
              event: publishedStateEvent,
              fetchRelayEvents: options.onFetchRelayEvents,
            });

            const refDetail = refDetailsByFullRef.get(ref.ref);
            if (refDetail) {
              stateRefsByFullRef.set(getGraspRefFullName(refDetail), refDetail);
            }
            currentStateHead = nextStateHead;
          }
        }
        activeRef = null;

        const missingRefs = orderedRefs.filter((ref) => !pushedRefsForTarget.includes(ref.ref));
        if (missingRefs.length > 0 || failedRefsForTarget.length > 0) {
          throw new Error(
            `GRASP target did not verify all requested refs: ${
              missingRefs.map((ref) => ref.ref).join(", ") ||
              failedRefsForTarget.map((ref) => ref.ref).join(", ")
            }`
          );
        }

        updateProgress(`Verifying remote refs on ${target.label}...`);
        const verifiedRefs = await verifyTargetRefs(target, graspRemoteUrl);

        await settleTarget(target, {
          id: target.id,
          label: target.label,
          provider: target.provider,
          success: true,
          remoteUrl,
          webUrl: webUrl || guessWebUrl(remoteUrl),
          createdRemote,
          pushedRefs: verifiedRefs,
          failedRefs: failedRefsForTarget.length > 0 ? failedRefsForTarget : undefined,
          warnings:
            warningsForTarget.length > 0 ? Array.from(new Set(warningsForTarget)) : undefined,
          relayUrl: normalizeGraspOrigins(target.relayUrl).wsOrigin,
          outcome: "ok",
          provisionalAnnouncementEvent: targetSignedAnnouncement,
          provisionalStateEvents,
        });
        continue;
      }

      if (getTargetTokens(target).length === 0) {
        throw new Error("Missing token for target host");
      }

      if (!remoteUrl) {
        const createResult = await tryTargetTokens<WorkerCreateRemoteRepoResult>(
          target,
          async (token) => {
            await emitCheckpoint(onCheckpoint, {
              action: "create",
              position: "before",
              target: getCheckpointTarget(target),
              stage: "creating",
              createdRemote: false,
            });
            let result: WorkerCreateRemoteRepoResult;
            try {
              const mutation = await runWorkerMutation<WorkerCreateRemoteRepoResult>(
                "createRemoteRepo",
                (mutationOperationId) =>
                  workerApi.createRemoteRepo({
                    provider: target.provider,
                    token,
                    name: repoName,
                    description: repoDescription,
                    isPrivate: false,
                    baseUrl: getProviderBaseUrl(target.provider, target.host),
                    operationId: mutationOperationId,
                  }),
                `Creating remote repository on ${target.label}`,
                45000
              );
              result = mutation.result;
              if (!result?.success || !result?.remoteUrl) {
                const status = await waitForMutationTerminal(
                  mutation.operationId,
                  "createRemoteRepo"
                );
                if (status.state === "unknown") {
                  throw new RemoteWorkerMutationError(
                    result?.error || "Failed to create remote repository",
                    mutation.operationId,
                    status
                  );
                }
              }
            } catch (error) {
              await emitCheckpoint(onCheckpoint, {
                action: "create",
                position: "after",
                target: getCheckpointTarget(target),
                stage: isUnknownRemoteOutcome(error) ? "unknown" : "failed",
                createdRemote: false,
                error: sanitizeCheckpointError(error, target),
              });
              throw error;
            }

            if (!result?.success || !result?.remoteUrl) {
              const error = result?.error || "Failed to create remote repository";
              await emitCheckpoint(onCheckpoint, {
                action: "create",
                position: "after",
                target: getCheckpointTarget(target),
                stage: "failed",
                createdRemote: false,
                error: sanitizeCheckpointError(error, target),
              });
              throw new Error(error);
            }

            await emitCheckpoint(onCheckpoint, {
              action: "create",
              position: "after",
              target: getCheckpointTarget(target),
              stage: "created",
              remoteUrl: result.remoteUrl,
              webUrl: guessWebUrl(result.remoteUrl),
              createdRemote: true,
            });
            provisionToken = token;
            return result;
          }
        );

        remoteUrl = createResult.remoteUrl;
        webUrl = guessWebUrl(createResult.remoteUrl);
        createdRemote = true;
      }

      if (!remoteUrl) {
        throw new Error("No remote URL available for push");
      }
      const targetRemoteUrl = remoteUrl;

      for (let refIndex = 0; refIndex < orderedRefs.length; refIndex++) {
        const ref = orderedRefs[refIndex];
        activeRef = ref;
        throwIfAborted?.();

        updateProgress(
          `Pushing ${ref.type === "heads" ? "branch" : "tag"} ${ref.name} to ${target.label} (${refIndex + 1}/${orderedRefs.length})...`
        );
        emitOperationProgress("Preparing ref push", {
          loaded: refIndex,
          total: orderedRefs.length,
          unit: "refs",
          target: target.label,
          ref: ref.ref,
        });

        const pushResult = await tryTargetTokens<WorkerPushToRemoteResult>(
          target,
          async (token) => {
            if (target.provider === "gitlab" && createdRemote) {
              await waitForGitLabPushReady(
                { runAbortable, throwIfAborted, withRateLimit: rateLimiter },
                target,
                targetRemoteUrl,
                token
              );
            }

            const maxAttempts = target.provider === "gitlab" && createdRemote ? 3 : 1;
            let lastError: unknown = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              try {
                await emitCheckpoint(onCheckpoint, {
                  action: "push",
                  position: "before",
                  target: getCheckpointTarget(target),
                  stage: "pushing",
                  remoteUrl: targetRemoteUrl,
                  createdRemote,
                  ref: {
                    ref: ref.ref,
                    ...(ref.commit ? { commit: ref.commit } : {}),
                    stage: "pushing",
                  },
                });
                const mutation = await runWorkerMutation<WorkerPushToRemoteResult>(
                  "pushToRemote",
                  (mutationOperationId) =>
                    workerApi.pushToRemote({
                      repoId: localRepoId,
                      remoteUrl: targetRemoteUrl,
                      branch: defaultBranch,
                      ref: ref.ref,
                      token,
                      provider: target.provider,
                      operationId: mutationOperationId,
                    }),
                  `Pushing ${ref.name} to ${target.label}`,
                  0
                );
                const result = mutation.result;

                if (!result?.success) {
                  const message = result?.error || `Failed to push ${ref.name} to ${target.label}`;
                  const status = await waitForMutationTerminal(
                    mutation.operationId,
                    "pushToRemote"
                  );
                  if (status.state === "unknown") {
                    throw new RemoteWorkerMutationError(message, mutation.operationId, status);
                  }
                  throw new RemotePushResultError(message, result);
                }

                await emitCheckpoint(onCheckpoint, {
                  action: "push",
                  position: "after",
                  target: getCheckpointTarget(target),
                  stage: "pushing",
                  remoteUrl: targetRemoteUrl,
                  createdRemote,
                  ref: {
                    ref: ref.ref,
                    ...(ref.commit ? { commit: ref.commit } : {}),
                    stage: "pushed",
                  },
                });
                return result;
              } catch (error) {
                if (error instanceof RemoteSyncCheckpointInterruption) throw error;
                lastError = error;
                const message = error instanceof Error ? error.message : String(error || "");
                const stage = isUnknownRemoteOutcome(error) ? "unknown" : "failed";
                await emitCheckpoint(onCheckpoint, {
                  action: "push",
                  position: "after",
                  target: getCheckpointTarget(target),
                  stage,
                  remoteUrl: targetRemoteUrl,
                  createdRemote,
                  error: sanitizeCheckpointError(error, target),
                  ref: {
                    ref: ref.ref,
                    ...(ref.commit ? { commit: ref.commit } : {}),
                    stage,
                    error: sanitizeCheckpointError(error, target),
                  },
                });
                if (stage === "unknown") throw error;
                const isRetryableGitLabError =
                  /404|not found|repository .* empty|project .* not found|could not read from remote/i.test(
                    message
                  );

                if (
                  attempt >= maxAttempts ||
                  target.provider !== "gitlab" ||
                  !createdRemote ||
                  !isRetryableGitLabError
                ) {
                  throw error;
                }

                await runAbortable(
                  () => new Promise<void>((resolve) => setTimeout(resolve, 1500 * attempt)),
                  `Retrying ${ref.name} push to ${target.label}`,
                  0
                );
              }
            }

            throw lastError instanceof Error
              ? lastError
              : new Error(String(lastError || "Push failed"));
          }
        );

        if (!pushResult?.success) {
          const message = pushResult?.error || `Failed to push ${ref.name} to ${target.label}`;
          throw new RemotePushResultError(message, pushResult);
        }

        collectPushResultDetails(
          pushResult,
          ref.ref,
          undefined,
          pushedRefsForTarget,
          failedRefsForTarget,
          warningsForTarget
        );
      }
      activeRef = null;

      updateProgress(`Verifying remote refs on ${target.label}...`);
      const verifiedRefs = await verifyTargetRefs(target, targetRemoteUrl);

      await settleTarget(target, {
        id: target.id,
        label: target.label,
        provider: target.provider,
        success: true,
        remoteUrl,
        webUrl: webUrl || guessWebUrl(remoteUrl),
        createdRemote,
        pushedRefs: verifiedRefs,
        failedRefs: failedRefsForTarget.length > 0 ? failedRefsForTarget : undefined,
        warnings: warningsForTarget.length > 0 ? Array.from(new Set(warningsForTarget)) : undefined,
        outcome: "ok",
      });
    } catch (error) {
      if (error instanceof RemoteSyncCheckpointInterruption) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const failedPushResult = getPushResultFromError(error);
      if (failedPushResult && activeRef) {
        collectPushResultDetails(
          failedPushResult,
          activeRef.ref,
          message,
          pushedRefsForTarget,
          failedRefsForTarget,
          warningsForTarget
        );
      } else if (activeRef) {
        addFailedRef(failedRefsForTarget, activeRef.ref, message);
      }
      if (
        remoteUrl &&
        workerApi?.listServerRefs &&
        orderedRefs.every((ref) => Boolean(ref.commit))
      ) {
        try {
          const verifiedRefs = await verifyTargetRefs(target, remoteUrl);
          if (target.provider === "grasp") {
            const latestStateEvent = provisionalStateEvents.at(-1);
            if (
              !target.relayUrl ||
              !onPublishEvent ||
              !options.onFetchRelayEvents ||
              !targetSignedAnnouncement ||
              !latestStateEvent
            ) {
              throw new Error("GRASP postflight metadata verification is unavailable");
            }
            await verifyGraspEventAfterPush({
              relayUrl: target.relayUrl,
              event: targetSignedAnnouncement,
              fetchRelayEvents: options.onFetchRelayEvents,
            });
            await verifyGraspEventAfterPush({
              relayUrl: target.relayUrl,
              event: latestStateEvent,
              fetchRelayEvents: options.onFetchRelayEvents,
            });
          }
          await settleTarget(target, {
            id: target.id,
            label: target.label,
            provider: target.provider,
            success: true,
            remoteUrl,
            webUrl: webUrl || guessWebUrl(remoteUrl),
            createdRemote,
            pushedRefs: verifiedRefs,
            warnings: [
              ...warningsForTarget,
              "Push reported failure but every requested remote ref was verified",
            ],
            outcome: "ok",
            relayUrl: target.relayUrl ? normalizeGraspOrigins(target.relayUrl).wsOrigin : undefined,
            provisionalAnnouncementEvent: targetSignedAnnouncement,
            provisionalStateEvents:
              provisionalStateEvents.length > 0 ? provisionalStateEvents : undefined,
          });
          continue;
        } catch (postflightError) {
          if (postflightError instanceof RemoteSyncCheckpointInterruption) throw postflightError;
          // Preserve the original outcome when postflight verification is unavailable.
        }
      }
      const partialSuffix =
        pushedRefsForTarget.length > 0
          ? ` (pushed ${Array.from(new Set(pushedRefsForTarget)).length}/${orderedRefs.length} refs before failure)`
          : "";
      const outcome = isUnknownRemoteOutcome(error) ? "unknown" : "failed";
      const cleanup =
        createdRemote &&
        target.provider !== "grasp" &&
        remoteUrl &&
        pushedRefsForTarget.length === 0 &&
        outcome === "failed"
          ? await cleanupEmptyCreatedRemote({
              workerApi,
              target,
              remoteUrl,
              token: provisionToken,
              beforeDelete: () =>
                emitCheckpoint(onCheckpoint, {
                  action: "cleanup",
                  position: "before",
                  target: getCheckpointTarget(target),
                  stage: "failed",
                  remoteUrl,
                  createdRemote,
                }),
              afterDelete: (cleanupResult) =>
                emitCheckpoint(onCheckpoint, {
                  action: "cleanup",
                  position: "after",
                  target: getCheckpointTarget(target),
                  stage: cleanupResult.unknown
                    ? "unknown"
                    : cleanupResult.success || cleanupResult.attempted
                      ? "failed"
                      : "unknown",
                  remoteUrl,
                  createdRemote,
                  cleanup: cleanupResult,
                  ...(cleanupResult.error
                    ? { error: sanitizeCheckpointError(cleanupResult.error, target) }
                    : {}),
                }),
              runWorkerMutation,
              waitForMutationTerminal,
            })
          : undefined;

      await settleTarget(target, {
        id: target.id,
        label: target.label,
        provider: target.provider,
        success: false,
        remoteUrl,
        webUrl: webUrl || guessWebUrl(remoteUrl),
        createdRemote,
        error: `${message}${partialSuffix}`,
        pushedRefs:
          pushedRefsForTarget.length > 0 ? Array.from(new Set(pushedRefsForTarget)) : undefined,
        failedRefs:
          failedRefsForTarget.length > 0
            ? Array.from(new Map(failedRefsForTarget.map((item) => [item.ref, item])).values())
            : undefined,
        warnings: warningsForTarget.length > 0 ? Array.from(new Set(warningsForTarget)) : undefined,
        relayUrl: target.relayUrl ? normalizeGraspOrigins(target.relayUrl).wsOrigin : undefined,
        outcome,
        cleanup,
        provisionalAnnouncementEvent: targetSignedAnnouncement,
        provisionalStateEvents:
          provisionalStateEvents.length > 0 ? provisionalStateEvents : undefined,
      });
    } finally {
      emitOperationProgress("Target settled", {
        loaded: i + 1,
        total: orderedTargets.length,
        unit: "targets",
        target: target.label,
      });
    }
  }

  emitOperationProgress("Remote synchronization complete", {
    loaded: orderedTargets.length,
    total: orderedTargets.length,
    unit: "targets",
  });
  return results;
}
