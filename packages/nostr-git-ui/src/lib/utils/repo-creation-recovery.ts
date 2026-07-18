import type { NostrEvent, RepoAnnouncementEvent } from "@nostr-git/core";
import { createRepoStateEvent } from "@nostr-git/core/events";

import {
  reconcileRepoCreationEvents,
  verifyGraspEventAfterPush,
  type DeleteRepoEvent,
  type FetchRelayEvents,
  type PublishRepoEvent,
} from "./grasp-pipeline.js";
import {
  getRepoCreationProvisionalEvents,
  getPendingRepoCreationTransactions,
  persistRepoCreationRecoveryRecord,
  removeRepoCreationRecoveryRecord,
  retryPendingRepoCreationMetadata,
  retryRepoCreationCompensations,
  type RepoCreationRecoveryRecord,
  type RepoCreationTargetRecord,
} from "./repo-creation-transaction.js";

export interface RepoCreationRecoveryDependencies {
  workerApi: any;
  publisher: PublishRepoEvent;
  fetchRelayEvents: FetchRelayEvents;
  onDeleteEvent: DeleteRepoEvent;
}

export interface RepoCreationRecoveryResult {
  status: "recovered" | "pending";
  record?: RepoCreationRecoveryRecord;
  reason?: string;
}

function latestEvent(record: RepoCreationRecoveryRecord, kind: number): NostrEvent | undefined {
  return record.publishedEvents
    .filter((item) => item.event.kind === kind)
    .sort((a, b) => b.event.created_at - a.event.created_at)[0]?.event;
}

function refsMatch(
  target: RepoCreationTargetRecord,
  advertised: Array<{ ref?: string; oid?: string }>
): boolean {
  const advertisedByRef = new Map(
    advertised.map((item) => [String(item.ref || ""), String(item.oid || "")])
  );
  const expected = target.refs.filter((ref) => ref.commit);
  return (
    expected.length > 0 &&
    expected.every(
      (ref) =>
        advertisedByRef.get(ref.ref) === ref.commit ||
        (ref.ref.startsWith("refs/tags/") && advertisedByRef.get(`${ref.ref}^{}`) === ref.commit)
    )
  );
}

async function probeTarget(
  record: RepoCreationRecoveryRecord,
  target: RepoCreationTargetRecord,
  deps: RepoCreationRecoveryDependencies
): Promise<RepoCreationTargetRecord> {
  if (!target.remoteUrl) {
    if (target.stage === "planned") {
      return { ...target, stage: "failed", manualAttention: false, updatedAt: Date.now() };
    }
    return {
      ...target,
      stage: "unknown",
      manualAttention: true,
      error: target.error || "Remote side-effect receipt is unavailable",
      updatedAt: Date.now(),
    };
  }

  try {
    const advertised = (await deps.workerApi.listServerRefs({
      url: target.remoteUrl,
      symrefs: true,
    })) as Array<{ ref?: string; oid?: string }>;
    if (!refsMatch(target, advertised || [])) {
      return {
        ...target,
        stage: "failed",
        manualAttention: Boolean(target.createdRemote),
        error: "Advertised refs do not match the checkpointed commits",
        updatedAt: Date.now(),
      };
    }

    if (target.provider === "grasp") {
      const announcement = latestEvent(record, 30617);
      const state = latestEvent(record, 30618);
      if (!target.relayUrl || !announcement || !state) {
        return {
          ...target,
          stage: "unknown",
          manualAttention: true,
          error: "Exact GRASP metadata evidence is incomplete",
          updatedAt: Date.now(),
        };
      }
      await verifyGraspEventAfterPush({
        relayUrl: target.relayUrl,
        event: announcement,
        fetchRelayEvents: deps.fetchRelayEvents,
      });
      await verifyGraspEventAfterPush({
        relayUrl: target.relayUrl,
        event: state,
        fetchRelayEvents: deps.fetchRelayEvents,
      });
    }

    return {
      ...target,
      stage: "verified",
      refs: target.refs.map((ref) => (ref.commit ? { ...ref, stage: "verified" as const } : ref)),
      manualAttention: false,
      updatedAt: Date.now(),
    };
  } catch (error) {
    return {
      ...target,
      stage: "unknown",
      manualAttention: true,
      error: error instanceof Error ? error.message : String(error),
      updatedAt: Date.now(),
    };
  }
}

async function cleanupLocalResource(
  record: RepoCreationRecoveryRecord,
  workerApi: any
): Promise<RepoCreationRecoveryRecord> {
  const local = record.localResource;
  const shouldDelete =
    local.ownedByTransaction &&
    Boolean(local.id || record.localRepoId) &&
    (record.operation === "import" ||
      record.operation === "fork" ||
      (record.operation === "new" &&
        !record.targets.some((target) => target.stage === "verified")));
  if (!shouldDelete || local.stage === "cleaned" || local.stage === "planned") return record;

  if (!workerApi?.deleteRepo) {
    return {
      ...record,
      phase: "cleanup-pending",
      localResource: { ...local, stage: "cleanup-pending", error: "Local deletion is unavailable" },
      manualAttention: { required: true, reason: "Local repository cleanup is pending" },
    };
  }

  try {
    const result = await workerApi.deleteRepo({ repoId: local.id || record.localRepoId });
    if (result?.success === false) throw new Error(result.error || "Local deletion failed");
    return { ...record, localResource: { ...local, stage: "cleaned", error: undefined } };
  } catch (error) {
    return {
      ...record,
      phase: "cleanup-pending",
      localResource: {
        ...local,
        stage: "cleanup-pending",
        error: error instanceof Error ? error.message : String(error),
      },
      manualAttention: { required: true, reason: "Local repository cleanup is pending" },
    };
  }
}

function buildRecoveredState(
  record: RepoCreationRecoveryRecord,
  targets: RepoCreationTargetRecord[]
) {
  const refs = new Map<string, string>();
  for (const target of targets) {
    for (const ref of target.refs) {
      if (ref.commit) refs.set(ref.ref, ref.commit);
    }
  }
  const parsedRefs = Array.from(refs).flatMap(([ref, commit]) => {
    const match = ref.match(/^refs\/(heads|tags)\/(.+)$/);
    return match ? [{ type: match[1] as "heads" | "tags", name: match[2], commit }] : [];
  });
  const head = parsedRefs.find((ref) => ref.type === "heads")?.name;
  if (parsedRefs.length === 0 || !head) return undefined;
  return createRepoStateEvent({ repoId: record.repoName, refs: parsedRefs, head });
}

async function finalizeVerifiedTargets(
  record: RepoCreationRecoveryRecord,
  verifiedTargets: RepoCreationTargetRecord[],
  deps: RepoCreationRecoveryDependencies
): Promise<RepoCreationRecoveryResult> {
  const provisionalAnnouncement = latestEvent(record, 30617);
  const stateEvent = buildRecoveredState(record, verifiedTargets);
  if (!provisionalAnnouncement || !stateEvent) {
    const pending = persistRepoCreationRecoveryRecord({
      ...record,
      targets: verifiedTargets,
      phase: "failed",
      manualAttention: { required: true, reason: "Final metadata must be reviewed manually" },
    });
    return { status: "pending", record: pending, reason: pending.manualAttention.reason };
  }

  const taggedRelays =
    provisionalAnnouncement.tags
      .find((tag) => tag[0] === "relays")
      ?.slice(1)
      .filter(Boolean) || [];
  const relays = Array.from(
    new Set([...taggedRelays, ...verifiedTargets.map((target) => target.relayUrl).filter(Boolean)])
  ) as string[];
  const cloneUrls = verifiedTargets.map((target) => target.remoteUrl).filter(Boolean) as string[];
  const webUrls = verifiedTargets.map((target) => target.webUrl).filter(Boolean) as string[];
  const graspTargets = verifiedTargets.flatMap((target) =>
    target.provider === "grasp" && target.relayUrl && target.remoteUrl
      ? [{ relayUrl: target.relayUrl, cloneUrl: target.remoteUrl, webUrl: target.webUrl }]
      : []
  );
  const { id: _id, sig: _sig, pubkey: _pubkey, ...announcementTemplate } = provisionalAnnouncement;
  const preservedTags = announcementTemplate.tags.filter(
    (tag) => !["clone", "web", "relays"].includes(tag[0])
  );
  const reconciled = await reconcileRepoCreationEvents({
    relayUrls: relays,
    provisionalRelayUrls: record.publishedEvents.flatMap((item) => item.relayUrls),
    graspTargets,
    stateEvent,
    onPublishEvent: deps.publisher,
    fetchRelayEvents: deps.fetchRelayEvents,
    provisionalEvents: getRepoCreationProvisionalEvents(record),
    onDeleteEvent: deps.onDeleteEvent,
    minCreatedAt: Math.max(
      provisionalAnnouncement.created_at,
      ...record.publishedEvents.map((item) => item.event.created_at)
    ),
    buildAnnouncement: ({ relays: nextRelays, graspCloneUrls, createdAt }) => {
      const retained = new Set([
        ...cloneUrls.filter((url) => !graspTargets.some((target) => target.cloneUrl === url)),
        ...graspCloneUrls,
      ]);
      return {
        ...announcementTemplate,
        created_at: createdAt,
        tags: [
          ...preservedTags,
          ...(webUrls.length > 0 ? [["web", ...webUrls]] : []),
          ["clone", ...Array.from(retained)],
          ["relays", ...nextRelays],
        ],
      } as RepoAnnouncementEvent;
    },
  });

  let next: RepoCreationRecoveryRecord = {
    ...record,
    phase: reconciled.cleanupFailures.length > 0 ? "cleanup-pending" : "failed",
    targets: record.targets.map(
      (target) => verifiedTargets.find((verified) => verified.id === target.id) || target
    ),
    targetResults: verifiedTargets.map((target) => ({
      id: target.id,
      label: target.label,
      provider: target.provider,
      success: true,
      remoteUrl: target.remoteUrl,
      webUrl: target.webUrl,
      createdRemote: target.createdRemote,
      outcome: "ok" as const,
      pushedRefs: target.refs.filter((ref) => ref.stage === "verified").map((ref) => ref.ref),
      relayUrl: target.relayUrl,
    })),
    publishedEvents: [
      ...record.publishedEvents,
      { event: reconciled.announcementEvent, relayUrls: reconciled.relays, stage: "final" },
      { event: reconciled.stateEvent, relayUrls: reconciled.relays, stage: "final" },
    ],
    pendingCompensations: reconciled.cleanupFailures,
    manualAttention:
      reconciled.cleanupFailures.length > 0
        ? { required: true, reason: "Metadata cleanup is pending" }
        : { required: false },
  };
  next = await cleanupLocalResource(next, deps.workerApi);
  if (
    next.pendingCompensations.length === 0 &&
    (!next.localResource.ownedByTransaction ||
      next.operation === "new" ||
      next.localResource.stage === "cleaned")
  ) {
    removeRepoCreationRecoveryRecord(record.id);
    return { status: "recovered" };
  }
  next = persistRepoCreationRecoveryRecord(next);
  return { status: "pending", record: next, reason: next.manualAttention.reason };
}

export async function recoverRepoCreationRecord(
  record: RepoCreationRecoveryRecord,
  deps: RepoCreationRecoveryDependencies
): Promise<RepoCreationRecoveryResult> {
  if (record.phase === "metadata-pending") {
    await retryPendingRepoCreationMetadata(record, deps.publisher, deps.fetchRelayEvents);
    const persisted =
      getPendingRepoCreationTransactions().find((item) => item.id === record.id) || record;
    const next = await cleanupLocalResource(persisted, deps.workerApi);
    if (
      next.pendingCompensations.length === 0 &&
      (next.operation === "new" ||
        !next.localResource.ownedByTransaction ||
        ["cleaned", "planned"].includes(next.localResource.stage))
    ) {
      removeRepoCreationRecoveryRecord(record.id);
      return { status: "recovered" };
    }
    const pending = persistRepoCreationRecoveryRecord(next);
    return { status: "pending", record: pending, reason: pending.manualAttention.reason };
  }

  if (record.phase === "cleanup-pending") {
    let next = await retryRepoCreationCompensations(record, deps.onDeleteEvent, deps.publisher);
    next = await cleanupLocalResource(next, deps.workerApi);
    if (
      next.pendingCompensations.length === 0 &&
      (next.operation === "new" ||
        !next.localResource.ownedByTransaction ||
        ["cleaned", "planned"].includes(next.localResource.stage))
    ) {
      removeRepoCreationRecoveryRecord(record.id);
      return { status: "recovered" };
    }
    next = persistRepoCreationRecoveryRecord(next);
    return { status: "pending", record: next, reason: next.manualAttention.reason };
  }

  const targets = await Promise.all(
    record.targets.map((target) => probeTarget(record, target, deps))
  );
  const verified = targets.filter((target) => target.stage === "verified");
  const unknown = targets.filter((target) => target.stage === "unknown");
  if (verified.length > 0) {
    return finalizeVerifiedTargets({ ...record, targets }, verified, deps);
  }

  if (unknown.length === 0 && !targets.some((target) => target.createdRemote)) {
    const failures: RepoCreationRecoveryRecord["pendingCompensations"] = [];
    for (const item of getRepoCreationProvisionalEvents(record).filter(
      (event) => event.relayUrls.length > 0
    )) {
      try {
        await deps.onDeleteEvent(item.event, item.relayUrls);
      } catch (error) {
        failures.push({
          action: "delete",
          eventId: item.event.id,
          relayUrls: item.relayUrls,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    let next = await cleanupLocalResource(
      { ...record, targets, pendingCompensations: failures },
      deps.workerApi
    );
    if (failures.length === 0 && ["cleaned", "planned"].includes(next.localResource.stage)) {
      removeRepoCreationRecoveryRecord(record.id);
      return { status: "recovered" };
    }
    next = persistRepoCreationRecoveryRecord({
      ...next,
      phase: "cleanup-pending",
      manualAttention: { required: true, reason: "Known failed transaction cleanup is pending" },
    });
    return { status: "pending", record: next, reason: next.manualAttention.reason };
  }

  const pending = persistRepoCreationRecoveryRecord({
    ...record,
    targets,
    phase: "failed",
    manualAttention: {
      required: true,
      reason: unknown[0]?.error || "Remote outcome is ambiguous and requires manual review",
    },
  });
  return { status: "pending", record: pending, reason: pending.manualAttention.reason };
}
