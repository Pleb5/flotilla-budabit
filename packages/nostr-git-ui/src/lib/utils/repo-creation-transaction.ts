import type { NostrEvent, RepoAnnouncementEvent } from "@nostr-git/core";
import { parseGraspRepoHttpUrl } from "@nostr-git/core/utils";

import type {
  DeleteRepoEvent,
  FetchRelayEvents,
  PublishRepoEvent,
  PublishRepoEventResult,
} from "./grasp-pipeline.js";
import {
  extractPublishRelayAck,
  normalizeGraspOrigins,
  reconcileRepoCreationEvents,
  verifyGraspEventAfterPush,
} from "./grasp-pipeline.js";
import type {
  RemoteSyncCheckpoint,
  RemoteSyncRefCheckpoint,
  RemoteSyncTargetResult,
} from "./remote-sync.js";
import type { RemoteTargetSelection } from "./remote-targets.js";
import type { OperationStatus } from "@nostr-git/core";
import { assertGraspCloneRelayCoupling } from "./grasp-service-coupling.js";

export type RepoCreationOperation = "new" | "import" | "fork";
export type RepoCreationPhase = "syncing" | "metadata-pending" | "cleanup-pending" | "failed";
export type RepoCreationTargetStage =
  | "planned"
  | "creating"
  | "created"
  | "pushing"
  | "verified"
  | "failed"
  | "unknown";
export type RepoCreationLocalResourceStage =
  | "planned"
  | "creating"
  | "created"
  | "cleanup-pending"
  | "cleaned"
  | "failed"
  | "unknown";
export type RepoCreationCleanupStage =
  | "not-needed"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "unknown";

export interface RepoCreationCleanupState {
  stage: RepoCreationCleanupStage;
  manualAttention: boolean;
  error?: string;
}

export interface RepoCreationLocalResource {
  id?: string;
  ownedByTransaction: boolean;
  stage: RepoCreationLocalResourceStage;
  error?: string;
}

export interface RepoCreationTargetRecord extends Pick<
  RemoteTargetSelection,
  "id" | "label" | "provider" | "host" | "relayUrl"
> {
  stage: RepoCreationTargetStage;
  remoteUrl?: string;
  webUrl?: string;
  createdRemote?: boolean;
  announcementEvent?: NostrEvent;
  refs: RemoteSyncRefCheckpoint[];
  cleanup: RepoCreationCleanupState;
  manualAttention: boolean;
  error?: string;
  updatedAt: number;
}

export interface RepoCreationPublishedEvent {
  event: NostrEvent;
  relayUrls: string[];
  stage?: "provisional" | "final";
}

export interface RepoCreationEventAckEvidence {
  eventId: string;
  stage: "provisional" | "final";
  requestedRelayUrls: string[];
  ackedRelays: string[];
  failedRelays: string[];
  successCount: number;
  hasRelayOutcomes: boolean;
  relayOutcomes: Array<{ relay: string; status: string; detail: string }>;
  recordedAt: number;
  migrated?: boolean;
}

export interface RepoCreationRecoveryRecord {
  version: 2;
  id: string;
  operation: RepoCreationOperation;
  ownerPubkey: string;
  repoName: string;
  repositoryRelayUrls?: string[];
  localRepoId?: string;
  sourceMetadata?: {
    cloneUrls: string[];
    webUrls: string[];
    announcementEvent?: NostrEvent;
  };
  localResource: RepoCreationLocalResource;
  phase: RepoCreationPhase;
  targets: RepoCreationTargetRecord[];
  targetResults: Array<
    Pick<
      RemoteSyncTargetResult,
      | "id"
      | "label"
      | "provider"
      | "success"
      | "remoteUrl"
      | "webUrl"
      | "createdRemote"
      | "outcome"
      | "error"
      | "cleanup"
      | "relayUrl"
      | "pushedRefs"
      | "failedRefs"
      | "warnings"
      | "provisionalAnnouncementEvent"
    >
  >;
  publishedEvents: RepoCreationPublishedEvent[];
  eventAcks: RepoCreationEventAckEvidence[];
  workerOperations?: OperationStatus[];
  pendingCompensations: Array<{
    action: "delete" | "republish";
    eventId: string;
    relayUrls: string[];
    error: string;
  }>;
  cleanup: RepoCreationCleanupState;
  manualAttention: { required: boolean; reason?: string };
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_PREFIX = "nostr-git:repo-creation:v2:";
const LEGACY_STORAGE_PREFIX = "nostr-git:repo-creation:v1:";

class RepoCreationJournalStorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "RepoCreationJournalStorageError";
  }
}

function getStorage(): Storage | undefined {
  return typeof localStorage !== "undefined" ? localStorage : undefined;
}

function getStorageKey(id: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(id)}`;
}

function writeRecord(record: RepoCreationRecoveryRecord): void {
  try {
    const storage = getStorage();
    if (!storage) {
      throw new Error("localStorage is unavailable");
    }
    const key = getStorageKey(record.id);
    const serialized = JSON.stringify(record);
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) {
      throw new Error("localStorage did not retain the journal record");
    }
  } catch (error) {
    if (error instanceof RepoCreationJournalStorageError) throw error;
    throw new RepoCreationJournalStorageError(
      `Failed to persist repository creation journal ${record.id}`,
      error
    );
  }
}

function removeRecord(id: string): void {
  try {
    const storage = getStorage();
    if (!storage) {
      throw new Error("localStorage is unavailable");
    }
    storage.removeItem(getStorageKey(id));
    storage.removeItem(`${LEGACY_STORAGE_PREFIX}${encodeURIComponent(id)}`);
  } catch (error) {
    throw new RepoCreationJournalStorageError(
      `Failed to remove repository creation journal ${id}`,
      error
    );
  }
}

function getPublishedEvent(result: unknown): NostrEvent | undefined {
  const event = (result as { event?: NostrEvent } | undefined)?.event;
  return event?.id && event.sig && event.pubkey ? event : undefined;
}

function redactSecrets(value: string | undefined, secrets: Iterable<string>): string | undefined {
  if (!value) return value;
  let sanitized = value;
  for (const secret of secrets) {
    if (!secret) continue;
    sanitized = sanitized.split(secret).join("[REDACTED]");
    sanitized = sanitized.split(encodeURIComponent(secret)).join("[REDACTED]");
  }
  return sanitized;
}

function sanitizeUrl(value: string | undefined, secrets: Iterable<string>): string | undefined {
  const redacted = redactSecrets(value, secrets);
  if (!redacted) return redacted;
  try {
    const url = new URL(redacted);
    url.username = "";
    url.password = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|auth|password|secret|api[-_]?key/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, redacted.endsWith("/") ? "/" : "");
  } catch {
    return redacted;
  }
}

function sanitizePersistedValue(value: unknown, secrets: Iterable<string>, key = ""): unknown {
  if (/token|password|secret|authorization|api[-_]?key/i.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    const redacted = redactSecrets(value, secrets) || "";
    return /^(?:https?|wss?):\/\//i.test(redacted)
      ? sanitizeUrl(redacted, secrets) || redacted
      : redacted;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePersistedValue(item, secrets));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, item]) => [
        entryKey,
        sanitizePersistedValue(item, secrets, entryKey),
      ])
    );
  }
  return value;
}

function sanitizeCleanup(
  cleanup: RemoteSyncTargetResult["cleanup"] | undefined,
  secrets: Iterable<string>
): RemoteSyncTargetResult["cleanup"] | undefined {
  if (!cleanup) return undefined;
  return {
    attempted: cleanup.attempted,
    success: cleanup.success,
    ...(cleanup.error ? { error: redactSecrets(cleanup.error, secrets) } : {}),
  };
}

function sanitizeRefCheckpoint(
  ref: RemoteSyncRefCheckpoint,
  secrets: Iterable<string>
): RemoteSyncRefCheckpoint {
  return {
    ref: ref.ref,
    ...(ref.commit ? { commit: ref.commit } : {}),
    stage: ref.stage,
    ...(ref.error ? { error: redactSecrets(ref.error, secrets) } : {}),
  };
}

function initialTargetCleanup(createdRemote = false): RepoCreationCleanupState {
  return createdRemote
    ? { stage: "unknown", manualAttention: true }
    : { stage: "not-needed", manualAttention: false };
}

function relayUrlKey(value: string): string {
  const trimmed = normalizeGraspOrigins(value).wsOrigin.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.search = "";
    return url.pathname === "/" ? url.origin : url.toString();
  } catch {
    return trimmed;
  }
}

function sanitizeTargets(
  targets: RemoteTargetSelection[],
  existingTargets: RepoCreationTargetRecord[] = [],
  secrets: Iterable<string> = []
): RepoCreationRecoveryRecord["targets"] {
  const now = Date.now();
  return targets.map(
    ({ id, label, provider, host, relayUrl, existingRemoteUrl, existingWebUrl }) => {
      const existing = existingTargets.find((target) => target.id === id);
      const remoteUrl = sanitizeUrl(existing?.remoteUrl || existingRemoteUrl, secrets);
      const webUrl = sanitizeUrl(existing?.webUrl || existingWebUrl, secrets);
      return {
        id,
        label,
        provider,
        ...(host ? { host } : {}),
        ...(relayUrl ? { relayUrl: sanitizeUrl(relayUrl, secrets) } : {}),
        stage: existing?.stage || (remoteUrl ? "created" : "planned"),
        ...(remoteUrl ? { remoteUrl } : {}),
        ...(webUrl ? { webUrl } : {}),
        ...(existing?.createdRemote !== undefined
          ? { createdRemote: existing.createdRemote }
          : remoteUrl
            ? { createdRemote: false }
            : {}),
        ...(existing?.announcementEvent
          ? {
              announcementEvent: {
                ...existing.announcementEvent,
                tags: existing.announcementEvent.tags.map((tag) => [...tag]),
              },
            }
          : {}),
        refs: (existing?.refs || []).map((ref) => sanitizeRefCheckpoint(ref, secrets)),
        cleanup: existing?.cleanup || initialTargetCleanup(false),
        manualAttention: existing?.manualAttention || false,
        ...(existing?.error ? { error: redactSecrets(existing.error, secrets) } : {}),
        updatedAt: existing?.updatedAt || now,
      };
    }
  );
}

function sanitizeResults(
  results: RemoteSyncTargetResult[],
  secrets: Iterable<string> = []
): RepoCreationRecoveryRecord["targetResults"] {
  return results.map(
    ({
      id,
      label,
      provider,
      success,
      remoteUrl,
      webUrl,
      createdRemote,
      outcome,
      error,
      cleanup,
      relayUrl,
      pushedRefs,
      failedRefs,
      warnings,
      provisionalAnnouncementEvent,
    }) => ({
      id,
      label,
      provider,
      success,
      ...(remoteUrl ? { remoteUrl: sanitizeUrl(remoteUrl, secrets) } : {}),
      ...(webUrl ? { webUrl: sanitizeUrl(webUrl, secrets) } : {}),
      ...(createdRemote !== undefined ? { createdRemote } : {}),
      ...(outcome ? { outcome } : {}),
      ...(error ? { error: redactSecrets(error, secrets) } : {}),
      ...(cleanup ? { cleanup: sanitizeCleanup(cleanup, secrets) } : {}),
      ...(relayUrl ? { relayUrl: sanitizeUrl(relayUrl, secrets) } : {}),
      ...(pushedRefs ? { pushedRefs: [...pushedRefs] } : {}),
      ...(failedRefs
        ? {
            failedRefs: failedRefs.map((item) => ({
              ref: item.ref,
              error: redactSecrets(item.error, secrets) || "sync failed",
            })),
          }
        : {}),
      ...(warnings
        ? { warnings: warnings.map((warning) => redactSecrets(warning, secrets) || "") }
        : {}),
      ...(provisionalAnnouncementEvent
        ? {
            provisionalAnnouncementEvent: {
              ...provisionalAnnouncementEvent,
              tags: provisionalAnnouncementEvent.tags.map((tag) => [...tag]),
            },
          }
        : {}),
    })
  );
}

function mergeRefs(
  current: RemoteSyncRefCheckpoint[],
  updates: RemoteSyncRefCheckpoint[],
  secrets: Iterable<string>
): RemoteSyncRefCheckpoint[] {
  const refs = new Map(current.map((ref) => [ref.ref, ref]));
  for (const ref of updates) {
    const sanitized = sanitizeRefCheckpoint(ref, secrets);
    refs.set(ref.ref, { ...refs.get(ref.ref), ...sanitized });
  }
  return Array.from(refs.values());
}

function cleanupStateFromResult(result: RemoteSyncTargetResult): RepoCreationCleanupState {
  if (result.cleanup?.success) return { stage: "completed", manualAttention: false };
  if (result.cleanup?.attempted) {
    return {
      stage: "failed",
      manualAttention: true,
      ...(result.cleanup.error ? { error: result.cleanup.error } : {}),
    };
  }
  if (!result.createdRemote) return { stage: "not-needed", manualAttention: false };
  if (result.success) return { stage: "not-needed", manualAttention: false };
  return {
    stage: result.outcome === "unknown" ? "unknown" : "pending",
    manualAttention: true,
    ...(result.cleanup?.error ? { error: result.cleanup.error } : {}),
  };
}

export class RepoCreationTransactionJournal {
  #record: RepoCreationRecoveryRecord;
  #secrets = new Set<string>();

  constructor(params: {
    id: string;
    operation: RepoCreationOperation;
    ownerPubkey: string;
    repoName: string;
    repositoryRelayUrls?: string[];
    localRepoId?: string;
    sourceMetadata?: {
      cloneUrls?: string[];
      webUrls?: string[];
      announcementEvent?: NostrEvent;
    };
    localResource?: Partial<
      Pick<RepoCreationLocalResource, "ownedByTransaction" | "stage" | "error">
    >;
  }) {
    const now = Date.now();
    this.#record = {
      version: 2,
      id: params.id,
      operation: params.operation,
      ownerPubkey: params.ownerPubkey,
      repoName: params.repoName,
      ...(params.repositoryRelayUrls
        ? {
            repositoryRelayUrls: params.repositoryRelayUrls
              .map((relay) => sanitizeUrl(relay, []))
              .filter((relay): relay is string => Boolean(relay)),
          }
        : {}),
      ...(params.localRepoId ? { localRepoId: params.localRepoId } : {}),
      ...(params.sourceMetadata
        ? {
            sourceMetadata: {
              cloneUrls:
                params.sourceMetadata.cloneUrls
                  ?.map((url) => sanitizeUrl(url, []))
                  .filter((url): url is string => Boolean(url)) || [],
              webUrls:
                params.sourceMetadata.webUrls
                  ?.map((url) => sanitizeUrl(url, []))
                  .filter((url): url is string => Boolean(url)) || [],
              ...(params.sourceMetadata.announcementEvent
                ? {
                    announcementEvent: {
                      ...params.sourceMetadata.announcementEvent,
                      tags: params.sourceMetadata.announcementEvent.tags.map((tag) => [...tag]),
                    },
                  }
                : {}),
            },
          }
        : {}),
      localResource: {
        ...(params.localRepoId ? { id: params.localRepoId } : {}),
        ownedByTransaction: params.localResource?.ownedByTransaction ?? true,
        stage: params.localResource?.stage || (params.localRepoId ? "unknown" : "planned"),
        ...(params.localResource?.error ? { error: params.localResource.error } : {}),
      },
      phase: "syncing",
      targets: [],
      targetResults: [],
      publishedEvents: [],
      eventAcks: [],
      workerOperations: [],
      pendingCompensations: [],
      cleanup: { stage: "not-needed", manualAttention: false },
      manualAttention: { required: false },
      createdAt: now,
      updatedAt: now,
    };
    writeRecord(this.#record);
  }

  get record(): RepoCreationRecoveryRecord {
    return this.#record;
  }

  setLocalRepoId(localRepoId: string): void {
    this.#update({
      localRepoId,
      localResource: {
        ...this.#record.localResource,
        id: localRepoId,
        stage: "created",
      },
    });
  }

  setLocalResourceStatus(stage: RepoCreationLocalResourceStage, error?: unknown): void {
    const message = this.#sanitizeError(error);
    this.#update({
      localResource: {
        ...this.#record.localResource,
        stage,
        ...(message ? { error: message } : {}),
      },
    });
  }

  setTargets(targets: RemoteTargetSelection[]): void {
    const previousSecrets = this.#secrets;
    this.#secrets = new Set([
      ...this.#secrets,
      ...targets.flatMap((target) => [target.token, ...(target.tokens || [])]).filter(Boolean),
    ] as string[]);
    try {
      this.#update({ targets: sanitizeTargets(targets, this.#record.targets, this.#secrets) });
    } catch (error) {
      this.#secrets = previousSecrets;
      throw error;
    }
  }

  recordGraspAnnouncementEvidence(relayUrl: string, event: NostrEvent): void {
    const relayKey = relayUrlKey(relayUrl);
    const targets = this.#record.targets.map((target) =>
      target.provider === "grasp" && relayUrlKey(target.relayUrl || "") === relayKey
        ? {
            ...target,
            announcementEvent: {
              ...event,
              tags: event.tags.map((tag) => [...tag]),
            },
            updatedAt: Date.now(),
          }
        : target
    );
    this.#update({ targets });
  }

  setTargetResults(results: RemoteSyncTargetResult[]): void {
    const targetResults = sanitizeResults(results, this.#secrets);
    let targets = this.#record.targets;
    for (const result of results) {
      targets = this.#targetsWithResult(targets, result);
    }
    const manualTarget = targets.find((target) => target.manualAttention);
    this.#update({
      targetResults,
      targets,
      manualAttention: manualTarget
        ? {
            required: true,
            reason: manualTarget.error || `${manualTarget.label} requires recovery`,
          }
        : this.#record.phase === "failed" || this.#record.phase === "cleanup-pending"
          ? this.#record.manualAttention
          : { required: false },
    });
  }

  recordTargetResult(result: RemoteSyncTargetResult): void {
    const results = [
      ...this.#record.targetResults.filter((item) => item.id !== result.id),
      result,
    ] as RemoteSyncTargetResult[];
    this.setTargetResults(results);
  }

  recordRemoteSyncCheckpoint(checkpoint: RemoteSyncCheckpoint): void {
    const current = this.#record.targets.find((target) => target.id === checkpoint.target.id);
    const now = Date.now();
    const target: RepoCreationTargetRecord = current || {
      ...checkpoint.target,
      stage: "planned",
      refs: [],
      cleanup: { stage: "not-needed", manualAttention: false },
      manualAttention: false,
      updatedAt: now,
    };
    const refs = mergeRefs(
      target.refs,
      [...(checkpoint.refs || []), ...(checkpoint.ref ? [checkpoint.ref] : [])],
      this.#secrets
    );
    const error = this.#sanitizeError(checkpoint.error);
    const remoteUrl = sanitizeUrl(checkpoint.remoteUrl || target.remoteUrl, this.#secrets);
    const webUrl = sanitizeUrl(checkpoint.webUrl || target.webUrl, this.#secrets);
    let cleanup = target.cleanup;
    if (checkpoint.createdRemote && checkpoint.stage !== "verified") {
      cleanup = { stage: "pending", manualAttention: true };
    } else if (checkpoint.stage === "verified") {
      cleanup = { stage: "not-needed", manualAttention: false };
    }
    if (checkpoint.action === "cleanup") {
      cleanup =
        checkpoint.position === "before"
          ? { stage: "running", manualAttention: true }
          : checkpoint.cleanup?.success
            ? { stage: "completed", manualAttention: false }
            : {
                stage: checkpoint.stage === "unknown" ? "unknown" : "failed",
                manualAttention: true,
                ...(checkpoint.cleanup?.error || error
                  ? { error: checkpoint.cleanup?.error || error }
                  : {}),
              };
    }
    const manualAttention =
      cleanup.manualAttention || checkpoint.stage === "failed" || checkpoint.stage === "unknown";
    const nextTarget: RepoCreationTargetRecord = {
      ...target,
      ...checkpoint.target,
      stage: checkpoint.stage,
      ...(remoteUrl ? { remoteUrl } : {}),
      ...(webUrl ? { webUrl } : {}),
      ...(checkpoint.createdRemote !== undefined
        ? { createdRemote: checkpoint.createdRemote }
        : {}),
      refs,
      cleanup,
      manualAttention,
      ...(error ? { error } : {}),
      updatedAt: now,
    };
    const nextTargets = [
      ...this.#record.targets.filter((item) => item.id !== checkpoint.target.id),
      nextTarget,
    ];
    const manualTarget = nextTargets.find((item) => item.manualAttention);
    this.#update({
      targets: nextTargets,
      manualAttention: manualTarget
        ? {
            required: true,
            reason: manualTarget.error || `${manualTarget.label} requires recovery`,
          }
        : this.#record.phase === "failed" || this.#record.phase === "cleanup-pending"
          ? this.#record.manualAttention
          : { required: false },
    });
  }

  setPhase(phase: RepoCreationPhase, error?: unknown): void {
    const lastError = this.#sanitizeError(error);
    const nextPhase =
      phase === "failed" && this.#record.pendingCompensations.length > 0
        ? "cleanup-pending"
        : phase;
    this.#update({
      phase: nextPhase,
      ...(lastError ? { lastError } : {}),
      ...(phase === "failed"
        ? {
            manualAttention: {
              required: true,
              reason: lastError || "Repository creation failed",
            },
          }
        : {}),
    });
  }

  recordPublishedEvent(
    result: unknown,
    relayUrls: string[] = [],
    stage?: RepoCreationPublishedEvent["stage"]
  ): void {
    const event = getPublishedEvent(result);
    if (!event) return;

    const ack = extractPublishRelayAck(result);
    const requestedRelayUrls = relayUrls
      .map((relay) => sanitizeUrl(relay, this.#secrets))
      .filter((relay): relay is string => Boolean(relay));
    const ackedRelays = ack.ackedRelays
      .map((relay) => sanitizeUrl(relay, this.#secrets))
      .filter((relay): relay is string => Boolean(relay));
    const failedRelays = ack.failedRelays
      .map((relay) => sanitizeUrl(relay, this.#secrets))
      .filter((relay): relay is string => Boolean(relay));
    const effectiveRelayUrls = ack.hasRelayOutcomes ? ackedRelays : [];
    const existing = this.#record.publishedEvents.find((item) => item.event.id === event.id);
    const next = existing
      ? this.#record.publishedEvents.map((item) =>
          item.event.id === event.id
            ? {
                ...item,
                relayUrls: Array.from(new Set([...item.relayUrls, ...effectiveRelayUrls])),
                ...(item.stage === "final" || stage === "final"
                  ? { stage: "final" as const }
                  : stage
                    ? { stage }
                    : {}),
              }
            : item
        )
      : [
          ...this.#record.publishedEvents,
          {
            event,
            relayUrls: Array.from(new Set(effectiveRelayUrls)),
            ...(stage ? { stage } : {}),
          },
        ];
    const evidence: RepoCreationEventAckEvidence = {
      eventId: event.id,
      stage: stage || "provisional",
      requestedRelayUrls,
      ackedRelays,
      failedRelays,
      successCount: ack.successCount,
      hasRelayOutcomes: ack.hasRelayOutcomes,
      relayOutcomes: (ack.relayOutcomes || []).map((outcome) => ({
        relay: sanitizeUrl(outcome.relay, this.#secrets) || outcome.relay,
        status: redactSecrets(outcome.status, this.#secrets) || "unknown",
        detail: redactSecrets(outcome.detail, this.#secrets) || "",
      })),
      recordedAt: Date.now(),
    };
    this.#update({ publishedEvents: next, eventAcks: [...this.#record.eventAcks, evidence] });
  }

  setPendingCompensations(failures: RepoCreationRecoveryRecord["pendingCompensations"]): void {
    const pendingCompensations = failures.map((failure) => ({
      ...failure,
      relayUrls: failure.relayUrls
        .map((relay) => sanitizeUrl(relay, this.#secrets))
        .filter((relay): relay is string => Boolean(relay)),
      error: redactSecrets(failure.error, this.#secrets) || "Cleanup failed",
    }));
    this.#update({
      pendingCompensations,
      cleanup:
        pendingCompensations.length > 0
          ? { stage: "pending", manualAttention: true }
          : { stage: "completed", manualAttention: false },
      ...(pendingCompensations.length > 0
        ? {
            manualAttention: {
              required: true,
              reason: "Repository event cleanup is pending",
            },
          }
        : this.#record.phase === "failed"
          ? {}
          : { manualAttention: { required: false } }),
    });
  }

  recordWorkerOperationStatus(status: OperationStatus): void {
    const sanitized = sanitizePersistedValue(status, this.#secrets) as OperationStatus;
    this.#update({
      workerOperations: [
        ...(this.#record.workerOperations || []).filter(
          (operation) => operation.operationId !== sanitized.operationId
        ),
        sanitized,
      ].slice(-100),
    });
  }

  complete(): void {
    if (this.#record.pendingCompensations.length > 0) {
      this.setPhase("cleanup-pending");
      return;
    }
    if (
      this.#record.operation !== "new" &&
      this.#record.localResource.ownedByTransaction &&
      !["cleaned", "planned"].includes(this.#record.localResource.stage)
    ) {
      this.setPhase("cleanup-pending", this.#record.localResource.error);
      return;
    }
    try {
      removeRecord(this.#record.id);
    } catch (error) {
      // Completion has no following side effect to guard; do not roll back a successful repository.
      this.#record = {
        ...this.#record,
        manualAttention: {
          required: true,
          reason: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  #update(patch: Partial<RepoCreationRecoveryRecord>): void {
    const next = { ...this.#record, ...patch, updatedAt: Date.now() };
    const serialized = JSON.stringify(next);
    for (const secret of this.#secrets) {
      if (
        secret &&
        (serialized.includes(secret) || serialized.includes(encodeURIComponent(secret)))
      ) {
        throw new RepoCreationJournalStorageError(
          `Refusing to persist credential material in repository creation journal ${next.id}`
        );
      }
    }
    writeRecord(next);
    this.#record = next;
  }

  #sanitizeError(error: unknown): string | undefined {
    const message = error instanceof Error ? error.message : error ? String(error) : undefined;
    return redactSecrets(message, this.#secrets);
  }

  #targetsWithResult(
    targets: RepoCreationTargetRecord[],
    result: RemoteSyncTargetResult
  ): RepoCreationTargetRecord[] {
    const current = targets.find((target) => target.id === result.id);
    const cleanup = cleanupStateFromResult(result);
    const stage: RepoCreationTargetStage = result.success
      ? "verified"
      : result.outcome === "unknown"
        ? "unknown"
        : "failed";
    const pushedRefs = (result.pushedRefs || []).map<RemoteSyncRefCheckpoint>((ref) => ({
      ref,
      stage: result.success ? "verified" : "pushed",
    }));
    const failedRefs = (result.failedRefs || []).map<RemoteSyncRefCheckpoint>((ref) => ({
      ref: ref.ref,
      stage: result.outcome === "unknown" ? "unknown" : "failed",
      error: redactSecrets(ref.error, this.#secrets),
    }));
    const remoteUrl = sanitizeUrl(result.remoteUrl || current?.remoteUrl, this.#secrets);
    const webUrl = sanitizeUrl(result.webUrl || current?.webUrl, this.#secrets);
    const error = redactSecrets(result.error, this.#secrets);
    const next: RepoCreationTargetRecord = {
      ...(current || {
        id: result.id,
        label: result.label,
        provider: result.provider,
        refs: [],
      }),
      id: result.id,
      label: result.label,
      provider: result.provider,
      stage,
      ...(remoteUrl ? { remoteUrl } : {}),
      ...(webUrl ? { webUrl } : {}),
      ...(result.createdRemote !== undefined ? { createdRemote: result.createdRemote } : {}),
      refs: mergeRefs(current?.refs || [], [...pushedRefs, ...failedRefs], this.#secrets),
      cleanup: {
        ...cleanup,
        ...(cleanup.error
          ? { error: redactSecrets(cleanup.error, this.#secrets) || cleanup.error }
          : {}),
      },
      manualAttention: !result.success,
      ...(error ? { error } : {}),
      updatedAt: Date.now(),
    };
    return [...targets.filter((target) => target.id !== result.id), next];
  }
}

export function getRepoCreationProvisionalEvents(
  record: RepoCreationRecoveryRecord
): RepoCreationPublishedEvent[] {
  return record.publishedEvents.filter((item) => item.stage === "provisional");
}

function getLatestPublishedEvent(
  record: RepoCreationRecoveryRecord,
  kind: number
): RepoCreationPublishedEvent | undefined {
  return record.publishedEvents
    .filter((item) => item.event.kind === kind && item.stage === "final")
    .sort((a, b) => {
      const createdAtDiff = b.event.created_at - a.event.created_at;
      if (createdAtDiff !== 0) return createdAtDiff;
      return a.event.id.localeCompare(b.event.id);
    })[0];
}

function getAnnouncementRelays(event: NostrEvent): string[] {
  return (
    event.tags
      .find((tag) => tag[0] === "relays")
      ?.slice(1)
      .filter(Boolean) || []
  );
}

export async function retryPendingRepoCreationMetadata(
  record: RepoCreationRecoveryRecord,
  publisher: PublishRepoEvent,
  fetchRelayEvents?: FetchRelayEvents
): Promise<{ announcement: PublishRepoEventResult; state: PublishRepoEventResult }> {
  if (record.phase !== "metadata-pending") {
    throw new Error(`Repository transaction ${record.id} is not metadata-pending`);
  }

  const announcement = getLatestPublishedEvent(record, 30617);
  const state = getLatestPublishedEvent(record, 30618);
  if (!announcement || !state) {
    throw new Error("Metadata recovery requires exact signed announcement and state events");
  }

  const taggedRelays = getAnnouncementRelays(announcement.event);
  const relays = Array.from(
    new Set(taggedRelays.length > 0 ? taggedRelays : announcement.relayUrls)
  );
  if (relays.length === 0) {
    throw new Error("Metadata recovery requires explicit relay destinations");
  }

  const successfulGraspTargets = record.targets
    .filter(
      (target) =>
        target.provider === "grasp" &&
        target.relayUrl &&
        record.targetResults.some(
          (targetResult) => targetResult.id === target.id && targetResult.success
        )
    )
    .flatMap((target) => {
      const targetResult = record.targetResults.find((result) => result.id === target.id);
      return targetResult?.remoteUrl
        ? [
            {
              relayUrl: target.relayUrl as string,
              cloneUrl: targetResult.remoteUrl,
              webUrl: targetResult.webUrl,
            },
          ]
        : [];
    });
  const authoritativeSourceCloneUrls =
    record.sourceMetadata?.announcementEvent?.tags
      .filter((tag) => tag[0] === "clone")
      .flatMap((tag) => tag.slice(1)) || [];
  assertGraspCloneRelayCoupling({
    repoRelayUrls: relays,
    cloneUrls: announcement.event.tags
      .filter((tag) => tag[0] === "clone")
      .flatMap((tag) => tag.slice(1)),
    knownServices: record.targets
      .filter((target) => target.provider === "grasp" && target.relayUrl)
      .map((target) => {
        const result = record.targetResults.find((item) => item.id === target.id);
        return {
          relayUrl: target.relayUrl as string,
          httpBaseAliases: [parseGraspRepoHttpUrl(result?.remoteUrl || "")?.httpBase || ""],
          sources: ["selected-target" as const],
        };
      }),
    ownerPubkey: record.ownerPubkey,
    identifier: record.repoName,
    allowedUnlistedCloneUrls: authoritativeSourceCloneUrls,
  });

  const publishExact = async (item: RepoCreationPublishedEvent, destinations: string[]) => {
    const result = await publisher(item.event, { relays: destinations, stage: "final" });
    if (getPublishedEvent(result)?.id !== item.event.id) {
      throw new Error(`Metadata recovery changed signed event ${item.event.id}`);
    }

    const ack = extractPublishRelayAck(result);
    if (!ack.hasRelayOutcomes || ack.ackedRelays.length === 0) {
      throw new Error(`Metadata recovery received no relay ACK for event ${item.event.id}`);
    }
    const acked = new Set(ack.ackedRelays.map((relay) => relay.replace(/\/+$/, "")));
    return {
      result,
      ackedRelays: destinations.filter((relay) => acked.has(relay.replace(/\/+$/, ""))),
    };
  };

  const announcementPublish = await publishExact(announcement, relays);
  const statePublish = await publishExact(state, announcementPublish.ackedRelays);
  const retainedRelaySet = new Set(
    statePublish.ackedRelays.map((relay) => relay.replace(/\/+$/, ""))
  );
  let effectiveAnnouncement = announcement.event;
  let effectiveState = state.event;
  let effectiveRelays = statePublish.ackedRelays;
  let result = {
    announcement: announcementPublish.result,
    state: statePublish.result,
  };
  let recoveryCleanupFailures: RepoCreationRecoveryRecord["pendingCompensations"] = [];
  if (statePublish.ackedRelays.length < relays.length) {
    const graspCloneUrls = new Set(successfulGraspTargets.map((target) => target.cloneUrl));
    const graspWebUrls = new Set(
      record.targetResults
        .filter((targetResult) =>
          successfulGraspTargets.some((target) => target.cloneUrl === targetResult.remoteUrl)
        )
        .map((targetResult) => targetResult.webUrl)
        .filter(Boolean)
    );
    const sourceCloneUrls = new Set(record.sourceMetadata?.cloneUrls || []);
    const sourceWebUrls = new Set(record.sourceMetadata?.webUrls || []);
    const preservedTags = announcement.event.tags.filter(
      (tag) => !["clone", "web", "relays"].includes(tag[0])
    );
    const fixedCloneUrls =
      announcement.event.tags
        .find((tag) => tag[0] === "clone")
        ?.slice(1)
        .filter((cloneUrl) => sourceCloneUrls.has(cloneUrl) || !graspCloneUrls.has(cloneUrl)) || [];
    const fixedWebUrls =
      announcement.event.tags
        .find((tag) => tag[0] === "web")
        ?.slice(1)
        .filter((webUrl) => sourceWebUrls.has(webUrl) || !graspWebUrls.has(webUrl)) || [];
    const { id: _id, sig: _sig, pubkey: _pubkey, ...announcementTemplate } = announcement.event;
    const reconciled = await reconcileRepoCreationEvents({
      relayUrls: statePublish.ackedRelays,
      graspTargets: successfulGraspTargets.filter((target) =>
        retainedRelaySet.has(target.relayUrl.replace(/\/+$/, ""))
      ),
      stateEvent: state.event,
      onPublishEvent: publisher,
      fetchRelayEvents,
      minCreatedAt: Math.max(announcement.event.created_at, state.event.created_at),
      ownerPubkey: record.ownerPubkey,
      identifier: record.repoName,
      allowedUnlistedCloneUrls: authoritativeSourceCloneUrls,
      buildAnnouncement: ({
        relays: activeRelays,
        graspCloneUrls: activeGraspClones,
        createdAt,
      }) => {
        const activeGraspWebUrls = successfulGraspTargets
          .filter((target) => activeGraspClones.includes(target.cloneUrl))
          .map((target) => target.webUrl)
          .filter((webUrl): webUrl is string => Boolean(webUrl));
        const finalWebUrls = Array.from(new Set([...fixedWebUrls, ...activeGraspWebUrls]));
        const finalCloneUrls = Array.from(new Set([...fixedCloneUrls, ...activeGraspClones]));
        return {
          ...announcementTemplate,
          created_at: createdAt,
          tags: [
            ...preservedTags.map((tag) => [...tag]),
            ...(finalWebUrls.length > 0 ? [["web", ...finalWebUrls]] : []),
            ...(finalCloneUrls.length > 0 ? [["clone", ...finalCloneUrls]] : []),
            ["relays", ...activeRelays],
          ],
        } as RepoAnnouncementEvent;
      },
    });
    effectiveAnnouncement = reconciled.announcementEvent;
    effectiveState = reconciled.stateEvent;
    effectiveRelays = reconciled.relays;
    recoveryCleanupFailures = reconciled.cleanupFailures;
    result = {
      announcement: {
        event: effectiveAnnouncement,
        ackedRelays: effectiveRelays,
        failedRelays: [],
        successCount: effectiveRelays.length,
        hasRelayOutcomes: true,
      },
      state: {
        event: effectiveState,
        ackedRelays: effectiveRelays,
        failedRelays: [],
        successCount: effectiveRelays.length,
        hasRelayOutcomes: true,
      },
    };
  }
  const successfulGraspRelays = successfulGraspTargets
    .map((target) => target.relayUrl)
    .filter((relayUrl) =>
      effectiveRelays.some((relay) => relay.replace(/\/+$/, "") === relayUrl.replace(/\/+$/, ""))
    );
  if (successfulGraspRelays.length > 0 && !fetchRelayEvents) {
    throw new Error("Metadata recovery requires GRASP post-push verification");
  }
  for (const relayUrl of successfulGraspRelays) {
    await verifyGraspEventAfterPush({
      relayUrl,
      event: effectiveAnnouncement,
      fetchRelayEvents: fetchRelayEvents as FetchRelayEvents,
    });
    await verifyGraspEventAfterPush({
      relayUrl,
      event: effectiveState,
      fetchRelayEvents: fetchRelayEvents as FetchRelayEvents,
    });
  }
  const recoveredEvents: RepoCreationPublishedEvent[] = [
    { event: effectiveAnnouncement, relayUrls: effectiveRelays, stage: "final" },
    { event: effectiveState, relayUrls: effectiveRelays, stage: "final" },
  ];
  const recoveredEventIds = new Set(recoveredEvents.map((item) => item.event.id));
  const recoveredRecord: RepoCreationRecoveryRecord = {
    ...record,
    publishedEvents: [
      ...record.publishedEvents.filter((item) => !recoveredEventIds.has(item.event.id)),
      ...recoveredEvents,
    ],
    eventAcks: [
      ...record.eventAcks.filter((item) => !recoveredEventIds.has(item.eventId)),
      ...recoveredEvents.map((item) => ({
        eventId: item.event.id,
        stage: "final" as const,
        requestedRelayUrls: [...effectiveRelays],
        ackedRelays: [...effectiveRelays],
        failedRelays: [],
        successCount: effectiveRelays.length,
        hasRelayOutcomes: true,
        relayOutcomes: effectiveRelays.map((relay) => ({
          relay,
          status: "success",
          detail: "recovered",
        })),
        recordedAt: Date.now(),
      })),
    ],
  };
  const pendingCompensations = [...record.pendingCompensations, ...recoveryCleanupFailures];
  if (pendingCompensations.length > 0) {
    writeRecord({
      ...recoveredRecord,
      phase: "cleanup-pending",
      pendingCompensations,
      updatedAt: Date.now(),
    });
  } else {
    removeRecord(record.id);
  }
  return result;
}

export async function retryRepoCreationCompensations(
  record: RepoCreationRecoveryRecord,
  onDeleteEvent: DeleteRepoEvent,
  publisher?: PublishRepoEvent
): Promise<RepoCreationRecoveryRecord> {
  const remaining: RepoCreationRecoveryRecord["pendingCompensations"] = [];
  for (const compensation of record.pendingCompensations) {
    const event = record.publishedEvents.find(
      (item) => item.event.id === compensation.eventId
    )?.event;
    if (!event) {
      remaining.push({ ...compensation, error: "Signed event is unavailable for exact deletion" });
      continue;
    }

    try {
      if (compensation.action === "republish") {
        if (!publisher) throw new Error("Repository event publisher is unavailable");
        const result = await publisher(event, {
          relays: compensation.relayUrls,
          stage: "final",
        });
        const ack = extractPublishRelayAck(result);
        const expectedDelistRejection = ack.relayOutcomes?.some((outcome) =>
          /service.*not listed|not listed|service.*omitted/i.test(outcome.detail || "")
        );
        if (ack.ackedRelays.length === 0 && !expectedDelistRejection) {
          throw new Error("Final de-list replacement was not acknowledged");
        }
      } else {
        await onDeleteEvent(event, compensation.relayUrls);
      }
    } catch (error) {
      remaining.push({
        ...compensation,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const next = {
    ...record,
    phase: remaining.length > 0 ? ("cleanup-pending" as const) : record.phase,
    pendingCompensations: remaining,
    updatedAt: Date.now(),
  };
  if (remaining.length > 0) writeRecord(next);
  else removeRecord(record.id);
  return next;
}

export function trackRepoCreationPublisher(
  journal: RepoCreationTransactionJournal,
  publisher: PublishRepoEvent | undefined
): PublishRepoEvent | undefined {
  if (!publisher) return undefined;

  return async (event, context): Promise<PublishRepoEventResult> => {
    const result = await publisher(event, context);
    if (event.kind === 30617 || event.kind === 30618) {
      journal.recordPublishedEvent(result, context?.relays || [], context?.stage || "provisional");
    }
    return result;
  };
}

function getLegacySecrets(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const secrets: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (/token|password|secret|authorization/i.test(key)) {
      if (typeof item === "string") secrets.push(item);
      if (Array.isArray(item)) {
        secrets.push(...item.filter((entry): entry is string => typeof entry === "string"));
      }
      continue;
    }
    if (Array.isArray(item)) {
      secrets.push(...item.flatMap(getLegacySecrets));
    } else if (item && typeof item === "object") {
      secrets.push(...getLegacySecrets(item));
    }
  }
  return secrets.filter(Boolean);
}

function migrateLegacyRecord(value: any): RepoCreationRecoveryRecord | undefined {
  if (
    value?.version !== 1 ||
    !value.id ||
    !value.repoName ||
    !["new", "import", "fork"].includes(value.operation) ||
    !["syncing", "metadata-pending", "cleanup-pending", "failed"].includes(value.phase) ||
    !value.updatedAt
  ) {
    return undefined;
  }

  const secrets = new Set(getLegacySecrets(value));
  const legacyTargets = (Array.isArray(value.targets) ? value.targets : []).flatMap(
    (target: any): RemoteTargetSelection[] =>
      target?.id && target?.label && target?.provider
        ? [
            {
              id: String(target.id),
              label: String(target.label),
              provider: target.provider,
              ...(target.host ? { host: String(target.host) } : {}),
              ...(target.relayUrl ? { relayUrl: String(target.relayUrl) } : {}),
            },
          ]
        : []
  );
  const legacyResults = (Array.isArray(value.targetResults) ? value.targetResults : []).filter(
    (result: any) => result?.id && result?.label && result?.provider
  ) as RemoteSyncTargetResult[];
  let targets = sanitizeTargets(legacyTargets, [], secrets);
  const now = Number(value.updatedAt);
  for (const result of legacyResults) {
    const current = targets.find((target) => target.id === result.id);
    const stage: RepoCreationTargetStage = result.success
      ? "verified"
      : result.outcome === "unknown"
        ? "unknown"
        : "failed";
    const cleanup = cleanupStateFromResult(result);
    const refs = mergeRefs(
      current?.refs || [],
      [
        ...(result.pushedRefs || []).map<RemoteSyncRefCheckpoint>((ref) => ({
          ref,
          stage: result.success ? "verified" : "pushed",
        })),
        ...(result.failedRefs || []).map<RemoteSyncRefCheckpoint>((ref) => ({
          ref: ref.ref,
          stage: result.outcome === "unknown" ? "unknown" : "failed",
          error: redactSecrets(ref.error, secrets),
        })),
      ],
      secrets
    );
    targets = [
      ...targets.filter((target) => target.id !== result.id),
      {
        ...(current || {
          id: result.id,
          label: result.label,
          provider: result.provider,
        }),
        stage,
        ...(result.remoteUrl ? { remoteUrl: sanitizeUrl(result.remoteUrl, secrets) } : {}),
        ...(result.webUrl ? { webUrl: sanitizeUrl(result.webUrl, secrets) } : {}),
        ...(result.createdRemote !== undefined ? { createdRemote: result.createdRemote } : {}),
        refs,
        cleanup: {
          ...cleanup,
          ...(cleanup.error
            ? { error: redactSecrets(cleanup.error, secrets) || cleanup.error }
            : {}),
        },
        manualAttention: !result.success,
        ...(result.error ? { error: redactSecrets(result.error, secrets) } : {}),
        updatedAt: now,
      },
    ];
  }

  const publishedEvents: RepoCreationPublishedEvent[] = (
    Array.isArray(value.publishedEvents) ? value.publishedEvents : []
  )
    .filter((item: any) => item?.event?.id)
    .map(
      (item: any): RepoCreationPublishedEvent => ({
        event: item.event,
        relayUrls: (Array.isArray(item.relayUrls) ? item.relayUrls : [])
          .map((relay: unknown) => sanitizeUrl(String(relay || ""), secrets))
          .filter((relay: string | undefined): relay is string => Boolean(relay)),
        ...(item.stage === "provisional" || item.stage === "final" ? { stage: item.stage } : {}),
      })
    );
  const pendingCompensations = (
    Array.isArray(value.pendingCompensations) ? value.pendingCompensations : []
  ).flatMap((item: any): RepoCreationRecoveryRecord["pendingCompensations"] =>
    (item?.action === "delete" || item?.action === "republish") && item?.eventId
      ? [
          {
            action: item.action,
            eventId: String(item.eventId),
            relayUrls: (Array.isArray(item.relayUrls) ? item.relayUrls : [])
              .map((relay: unknown) => sanitizeUrl(String(relay || ""), secrets))
              .filter((relay: string | undefined): relay is string => Boolean(relay)),
            error:
              redactSecrets(String(item.error || "Cleanup failed"), secrets) || "Cleanup failed",
          },
        ]
      : []
  );
  const manualTarget = targets.find((target) => target.manualAttention);
  const lastError = redactSecrets(
    typeof value.lastError === "string" ? value.lastError : undefined,
    secrets
  );
  const migrated: RepoCreationRecoveryRecord = {
    version: 2,
    id: String(value.id),
    operation: value.operation,
    ownerPubkey: String(value.ownerPubkey || ""),
    repoName: String(value.repoName),
    ...(value.localRepoId ? { localRepoId: String(value.localRepoId) } : {}),
    localResource: {
      ...(value.localRepoId ? { id: String(value.localRepoId) } : {}),
      ownedByTransaction: true,
      stage: value.localRepoId ? "unknown" : "planned",
    },
    phase: value.phase,
    targets,
    targetResults: sanitizeResults(legacyResults, secrets),
    publishedEvents,
    eventAcks: publishedEvents.map((item) => ({
      eventId: item.event.id,
      stage: item.stage || "provisional",
      requestedRelayUrls: [...item.relayUrls],
      ackedRelays: [...item.relayUrls],
      failedRelays: [],
      successCount: item.relayUrls.length,
      hasRelayOutcomes: false,
      relayOutcomes: [],
      recordedAt: now,
      migrated: true,
    })),
    workerOperations: [],
    pendingCompensations,
    cleanup:
      pendingCompensations.length > 0
        ? { stage: "pending", manualAttention: true }
        : { stage: "not-needed", manualAttention: false },
    manualAttention:
      value.phase === "failed" || value.phase === "cleanup-pending" || manualTarget
        ? {
            required: true,
            reason:
              lastError || manualTarget?.error || "Migrated repository creation requires recovery",
          }
        : { required: false },
    ...(lastError ? { lastError } : {}),
    createdAt: Number(value.createdAt) || now,
    updatedAt: now,
  };

  const serialized = JSON.stringify(migrated);
  if (
    Array.from(secrets).some(
      (secret) =>
        secret && (serialized.includes(secret) || serialized.includes(encodeURIComponent(secret)))
    )
  ) {
    throw new RepoCreationJournalStorageError(
      `Refusing to migrate credential material in repository creation journal ${migrated.id}`
    );
  }
  return migrated;
}

function isRecoveryRecord(value: any): value is RepoCreationRecoveryRecord {
  return (
    value?.version === 2 &&
    Boolean(value.id && value.updatedAt) &&
    Array.isArray(value.targets) &&
    Array.isArray(value.targetResults) &&
    Array.isArray(value.publishedEvents) &&
    Array.isArray(value.eventAcks)
  );
}

export function getPendingRepoCreationTransactions(
  _now = Date.now()
): RepoCreationRecoveryRecord[] {
  let storage: Storage | undefined;
  try {
    storage = getStorage();
  } catch (error) {
    throw new RepoCreationJournalStorageError(
      "Failed to access repository creation journals",
      error
    );
  }
  if (!storage) return [];

  const records = new Map<string, RepoCreationRecoveryRecord>();
  let keys: Array<string | null>;
  try {
    keys = Array.from({ length: storage.length }, (_, index) => storage?.key(index) || null).sort(
      (a, b) =>
        Number(Boolean(b?.startsWith(STORAGE_PREFIX))) -
        Number(Boolean(a?.startsWith(STORAGE_PREFIX)))
    );
  } catch (error) {
    throw new RepoCreationJournalStorageError(
      "Failed to enumerate repository creation journals",
      error
    );
  }
  for (const key of keys) {
    const isCurrent = key?.startsWith(STORAGE_PREFIX);
    const isLegacy = key?.startsWith(LEGACY_STORAGE_PREFIX);
    if (!key || (!isCurrent && !isLegacy)) continue;

    let serialized: string | null;
    try {
      serialized = storage.getItem(key);
    } catch (error) {
      throw new RepoCreationJournalStorageError(
        `Failed to read repository creation journal ${key}`,
        error
      );
    }

    let value: any;
    try {
      value = JSON.parse(serialized || "");
    } catch {
      try {
        storage.removeItem(key);
      } catch (removeError) {
        throw new RepoCreationJournalStorageError(
          `Failed to remove unreadable repository creation journal ${key}`,
          removeError
        );
      }
      continue;
    }

    const record = isCurrent
      ? isRecoveryRecord(value)
        ? value
        : undefined
      : migrateLegacyRecord(value);
    if (!record) continue;
    if (isLegacy) {
      const current = records.get(record.id);
      if (!current) writeRecord(record);
      try {
        storage.removeItem(key);
      } catch (error) {
        throw new RepoCreationJournalStorageError(
          `Failed to finish repository creation journal migration ${record.id}`,
          error
        );
      }
      if (current) continue;
    }
    const existing = records.get(record.id);
    if (!existing || existing.updatedAt <= record.updatedAt) records.set(record.id, record);
  }

  return Array.from(records.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function persistRepoCreationRecoveryRecord(
  record: RepoCreationRecoveryRecord
): RepoCreationRecoveryRecord {
  const next = { ...record, version: 2 as const, updatedAt: Date.now() };
  writeRecord(next);
  return next;
}

export function removeRepoCreationRecoveryRecord(id: string): void {
  removeRecord(id);
}
