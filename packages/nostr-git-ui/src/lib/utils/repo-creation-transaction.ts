import type { NostrEvent, RepoAnnouncementEvent } from "@nostr-git/core";

import type {
  DeleteRepoEvent,
  FetchRelayEvents,
  PublishRepoEvent,
  PublishRepoEventResult,
} from "./grasp-pipeline.js";
import {
  extractPublishRelayAck,
  reconcileRepoCreationEvents,
  verifyGraspEventAfterPush,
} from "./grasp-pipeline.js";
import type { RemoteSyncTargetResult } from "./remote-sync.js";
import type { RemoteTargetSelection } from "./remote-targets.js";

export type RepoCreationOperation = "new" | "import" | "fork";
export type RepoCreationPhase = "syncing" | "metadata-pending" | "cleanup-pending" | "failed";

export interface RepoCreationPublishedEvent {
  event: NostrEvent;
  relayUrls: string[];
  stage?: "provisional" | "final";
}

export interface RepoCreationRecoveryRecord {
  version: 1;
  id: string;
  operation: RepoCreationOperation;
  ownerPubkey: string;
  repoName: string;
  localRepoId?: string;
  phase: RepoCreationPhase;
  targets: Array<Pick<RemoteTargetSelection, "id" | "label" | "provider" | "host" | "relayUrl">>;
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
    >
  >;
  publishedEvents: RepoCreationPublishedEvent[];
  pendingCompensations: Array<{
    action: "delete" | "republish";
    eventId: string;
    relayUrls: string[];
    error: string;
  }>;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_PREFIX = "nostr-git:repo-creation:v1:";
const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;

function getStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

function getStorageKey(id: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(id)}`;
}

function writeRecord(record: RepoCreationRecoveryRecord): void {
  try {
    getStorage()?.setItem(getStorageKey(record.id), JSON.stringify(record));
  } catch {
    // Recovery persistence is best effort; creation must not fail because storage is unavailable.
  }
}

function removeRecord(id: string): void {
  try {
    getStorage()?.removeItem(getStorageKey(id));
  } catch {
    // pass
  }
}

function getPublishedEvent(result: unknown): NostrEvent | undefined {
  const event = (result as { event?: NostrEvent } | undefined)?.event;
  return event?.id && event.sig && event.pubkey ? event : undefined;
}

function sanitizeTargets(targets: RemoteTargetSelection[]): RepoCreationRecoveryRecord["targets"] {
  return targets.map(({ id, label, provider, host, relayUrl }) => ({
    id,
    label,
    provider,
    ...(host ? { host } : {}),
    ...(relayUrl ? { relayUrl } : {}),
  }));
}

function sanitizeResults(
  results: RemoteSyncTargetResult[]
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
    }) => ({
      id,
      label,
      provider,
      success,
      ...(remoteUrl ? { remoteUrl } : {}),
      ...(webUrl ? { webUrl } : {}),
      ...(createdRemote !== undefined ? { createdRemote } : {}),
      ...(outcome ? { outcome } : {}),
      ...(error ? { error } : {}),
      ...(cleanup ? { cleanup } : {}),
    })
  );
}

export class RepoCreationTransactionJournal {
  #record: RepoCreationRecoveryRecord;

  constructor(params: {
    id: string;
    operation: RepoCreationOperation;
    ownerPubkey: string;
    repoName: string;
    localRepoId?: string;
  }) {
    const now = Date.now();
    this.#record = {
      version: 1,
      id: params.id,
      operation: params.operation,
      ownerPubkey: params.ownerPubkey,
      repoName: params.repoName,
      ...(params.localRepoId ? { localRepoId: params.localRepoId } : {}),
      phase: "syncing",
      targets: [],
      targetResults: [],
      publishedEvents: [],
      pendingCompensations: [],
      createdAt: now,
      updatedAt: now,
    };
    writeRecord(this.#record);
  }

  get record(): RepoCreationRecoveryRecord {
    return this.#record;
  }

  setLocalRepoId(localRepoId: string): void {
    this.#update({ localRepoId });
  }

  setTargets(targets: RemoteTargetSelection[]): void {
    this.#update({ targets: sanitizeTargets(targets) });
  }

  setTargetResults(results: RemoteSyncTargetResult[]): void {
    this.#update({ targetResults: sanitizeResults(results) });
  }

  setPhase(phase: RepoCreationPhase, error?: unknown): void {
    const lastError = error instanceof Error ? error.message : error ? String(error) : undefined;
    const nextPhase =
      phase === "failed" && this.#record.pendingCompensations.length > 0
        ? "cleanup-pending"
        : phase;
    this.#update({ phase: nextPhase, ...(lastError ? { lastError } : {}) });
  }

  recordPublishedEvent(
    result: unknown,
    relayUrls: string[] = [],
    stage?: RepoCreationPublishedEvent["stage"]
  ): void {
    const event = getPublishedEvent(result);
    if (!event) return;

    const existing = this.#record.publishedEvents.find((item) => item.event.id === event.id);
    const next = existing
      ? this.#record.publishedEvents.map((item) =>
          item.event.id === event.id
            ? {
                ...item,
                relayUrls: Array.from(new Set([...item.relayUrls, ...relayUrls])),
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
          { event, relayUrls: Array.from(new Set(relayUrls)), ...(stage ? { stage } : {}) },
        ];
    this.#update({ publishedEvents: next });
  }

  setPendingCompensations(failures: RepoCreationRecoveryRecord["pendingCompensations"]): void {
    this.#update({ pendingCompensations: failures });
  }

  complete(): void {
    if (this.#record.pendingCompensations.length > 0) {
      this.setPhase("cleanup-pending");
      return;
    }
    removeRecord(this.#record.id);
  }

  #update(patch: Partial<RepoCreationRecoveryRecord>): void {
    this.#record = { ...this.#record, ...patch, updatedAt: Date.now() };
    writeRecord(this.#record);
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
    const preservedTags = announcement.event.tags.filter(
      (tag) => !["clone", "web", "relays"].includes(tag[0])
    );
    const fixedCloneUrls =
      announcement.event.tags
        .find((tag) => tag[0] === "clone")
        ?.slice(1)
        .filter((cloneUrl) => !graspCloneUrls.has(cloneUrl)) || [];
    const fixedWebUrls =
      announcement.event.tags
        .find((tag) => tag[0] === "web")
        ?.slice(1)
        .filter((webUrl) => !graspWebUrls.has(webUrl)) || [];
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
      buildAnnouncement: ({
        relays: activeRelays,
        graspCloneUrls: activeGraspClones,
        createdAt,
      }) => {
        const activeGraspWebUrls = successfulGraspTargets
          .filter((target) => activeGraspClones.includes(target.cloneUrl))
          .map((target) => target.webUrl)
          .filter((webUrl): webUrl is string => Boolean(webUrl));
        return {
          ...announcementTemplate,
          created_at: createdAt,
          tags: [
            ...preservedTags.map((tag) => [...tag]),
            ...(fixedWebUrls.length + activeGraspWebUrls.length > 0
              ? [["web", ...fixedWebUrls, ...activeGraspWebUrls]]
              : []),
            ...(fixedCloneUrls.length + activeGraspClones.length > 0
              ? [["clone", ...fixedCloneUrls, ...activeGraspClones]]
              : []),
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
  const pendingCompensations = [...record.pendingCompensations, ...recoveryCleanupFailures];
  if (pendingCompensations.length > 0) {
    writeRecord({
      ...record,
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
      const ack = extractPublishRelayAck(result);
      journal.recordPublishedEvent(
        result,
        ack.hasRelayOutcomes ? ack.ackedRelays : context?.relays || [],
        context?.stage || "provisional"
      );
    }
    return result;
  };
}

export function getPendingRepoCreationTransactions(now = Date.now()): RepoCreationRecoveryRecord[] {
  const storage = getStorage();
  if (!storage) return [];

  const records: RepoCreationRecoveryRecord[] = [];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (!key?.startsWith(STORAGE_PREFIX)) continue;

    try {
      const record = JSON.parse(storage.getItem(key) || "") as RepoCreationRecoveryRecord;
      if (record.version !== 1 || !record.id || !record.updatedAt) continue;
      if (now - record.updatedAt > RECOVERY_TTL_MS) {
        storage.removeItem(key);
        continue;
      }
      records.push(record);
    } catch {
      storage.removeItem(key);
    }
  }

  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}
