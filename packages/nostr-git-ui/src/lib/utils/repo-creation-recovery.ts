import type { NostrEvent, RepoAnnouncementEvent } from "@nostr-git/core";
import { createRepoStateEvent } from "@nostr-git/core/events";
import { normalizeRelayUrl, sanitizeRelays } from "@nostr-git/core/utils";

import {
  reconcileRepoCreationEvents,
  verifyGraspEventAfterPush,
  type DeleteRepoEvent,
  type FetchRelayEvents,
  type PublishRepoEvent,
} from "./grasp-pipeline.js";
import {
  assertRepoCreationEvent,
  getLatestPublishedEvent,
  RepoCreationTransactionJournal,
  RepoCreationMetadataDeliveryError,
  scopeRepoCreationPublisher,
  trackRepoCreationPublisher,
  getRepoCreationProvisionalEvents,
  getPendingRepoCreationTransactions,
  persistRepoCreationRecoveryRecord,
  removeRepoCreationRecoveryRecord,
  retryPendingRepoCreationMetadata,
  retryRepoCreationCompensations,
  type RepoCreationRecoveryRecord,
  type RepoCreationTargetRecord,
} from "./repo-creation-transaction.js";
import { reserveRepoCreation } from "./repo-creation-preflight.js";
import {
  assertRecoveryStateCurrent,
  RepoRecoveryStateConflict,
  sameRecoveryStateContents,
} from "./repo-creation-state.js";
import {
  assertRecoveryAnnouncementCurrent,
  metadataValues,
  readCurrentRecoveryAnnouncement,
  RepoMetadataReviewRequired,
} from "./repo-creation-metadata.js";

export interface RepoCreationRecoveryDependencies {
  workerApi: any;
  publisher: PublishRepoEvent;
  fetchRelayEvents: FetchRelayEvents;
  onDeleteEvent: DeleteRepoEvent;
  /** Explicit owner approval of the announcement shown by the recovery UI. */
  reviewedAnnouncement?: NostrEvent;
  /** Rechecked before recovery side effects, including exact deletion. */
  assertCurrent?: () => void;
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

function supersedes(event: NostrEvent, saved: NostrEvent): boolean {
  return (
    event.created_at > saved.created_at ||
    (event.created_at === saved.created_at && event.id < saved.id)
  );
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
      const announcement =
        target.announcementEvent ||
        record.targetResults.find((result) => result.id === target.id)
          ?.provisionalAnnouncementEvent ||
        latestEvent(record, 30617);
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
  workerApi: any,
  assertCurrent?: () => void
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
    assertCurrent?.();
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
  return createRepoStateEvent({
    repoId: record.repoName,
    identifier: record.repoName,
    refs: parsedRefs,
    head,
  });
}

async function finalizeVerifiedTargets(
  record: RepoCreationRecoveryRecord,
  verifiedTargets: RepoCreationTargetRecord[],
  deps: RepoCreationRecoveryDependencies
): Promise<RepoCreationRecoveryResult> {
  const provisionalAnnouncement = latestEvent(record, 30617);
  let sourceAnnouncement = record.sourceMetadata?.announcementEvent;
  let announcementBase = sourceAnnouncement || provisionalAnnouncement;
  let stateEvent = buildRecoveredState(record, verifiedTargets);
  if (!announcementBase || !stateEvent) {
    const pending = persistRepoCreationRecoveryRecord({
      ...record,
      targets: verifiedTargets,
      phase: "failed",
      manualAttention: { required: true, reason: "Final metadata must be reviewed manually" },
    });
    return { status: "pending", record: pending, reason: pending.manualAttention.reason };
  }

  const current = await readCurrentRecoveryAnnouncement(
    record,
    announcementBase,
    deps.fetchRelayEvents
  );
  if (deps.reviewedAnnouncement) assertRepoCreationEvent(record, deps.reviewedAnnouncement, true);
  const expectedId = deps.reviewedAnnouncement?.id || announcementBase.id;
  if (
    current.id !== expectedId ||
    (record.phase === "metadata-review" && !deps.reviewedAnnouncement)
  )
    throw new RepoMetadataReviewRequired(
      "Review the current owner metadata before finishing this repository operation.",
      current
    );
  const rebased = announcementBase.id !== current.id;
  if (rebased) {
    const oldRelays = new Set(sanitizeRelays(metadataValues(announcementBase, "relays")));
    record = {
      ...record,
      sourceMetadata: {
        announcementEvent: current,
        cloneUrls: metadataValues(current, "clone"),
        webUrls: metadataValues(current, "web"),
      },
      repositoryRelayUrls: sanitizeRelays([
        ...metadataValues(current, "relays"),
        ...(record.repositoryRelayUrls || []).filter(
          (relay) => !oldRelays.has(normalizeRelayUrl(relay))
        ),
      ]),
    };
    sourceAnnouncement = current;
    announcementBase = current;
  }
  // Preserve a returned signed half-pair instead of recreating it on retry.
  const previousState = getLatestPublishedEvent(record, 30618)?.event;
  const sameTags = (left: string[][], right: string[][]) =>
    JSON.stringify(left.map((tag) => JSON.stringify(tag)).sort()) ===
    JSON.stringify(right.map((tag) => JSON.stringify(tag)).sort());
  if (previousState && sameTags(previousState.tags, stateEvent.tags))
    stateEvent = previousState as typeof stateEvent;
  const previousAnnouncement = !rebased ? getLatestPublishedEvent(record, 30617)?.event : undefined;
  let firstRound = true;
  record = persistRepoCreationRecoveryRecord({
    ...record,
    phase: "metadata-preparing",
    reviewAnnouncement: undefined,
    manualAttention: { required: false },
    metadataAttempt: {
      announcementEventId: previousAnnouncement?.id,
      stateEventId: stateEvent.id || undefined,
    },
  });
  const journal = RepoCreationTransactionJournal.resume(record);
  const trackedPublisher = trackRepoCreationPublisher(journal, deps.publisher)!;
  let stateSnapshot = {
    ...stateEvent,
    tags: stateEvent.tags.map((tag) => [...tag] as typeof tag),
  };
  const assertStateCurrent = async (requireNewerTimestamp = false) => {
    try {
      const evidence = await assertRecoveryStateCurrent({
        record: journal.record,
        announcement: current,
        state: stateSnapshot,
        targets: verifiedTargets,
        fetchEvents: deps.fetchRelayEvents,
        listServerRefs: (params) => deps.workerApi.listServerRefs(params),
        requireNewerTimestamp,
      });
      if (evidence.observed) journal.recordRecoveryStateObservation(evidence.observed);
      return evidence;
    } catch (error) {
      // The sign-only fallback may catch errors inside reconciliation. Keep the
      // evidence even if that caller reports a different delivery failure.
      if (error instanceof RepoRecoveryStateConflict && error.stateEvent)
        journal.recordRecoveryStateObservation(error.stateEvent);
      throw error;
    }
  };
  // Check before either final event is delivered. Check again around state signing
  // so an intervening push/state publication cannot be hidden by signing latency.
  const evidence = await assertStateCurrent();
  if (!(stateEvent.id && stateEvent.sig)) {
    stateEvent = {
      ...stateEvent,
      created_at: Math.max(stateEvent.created_at, (evidence.newest?.created_at || 0) + 1),
    };
    stateSnapshot = { ...stateEvent, tags: stateEvent.tags.map((tag) => [...tag] as typeof tag) };
  }
  const publisher: PublishRepoEvent = async (event, context) => {
    const signsState = event.kind === 30618 && !(event.id && event.sig);
    const assertFresh = async () => {
      await assertRecoveryAnnouncementCurrent(journal.record, current, deps.fetchRelayEvents);
      if (signsState) await assertStateCurrent(true);
    };
    await assertFresh();
    return trackedPublisher(event, { ...context, relays: context?.relays || [], assertFresh });
  };

  const taggedRelays =
    record.repositoryRelayUrls && record.repositoryRelayUrls.length > 0
      ? record.repositoryRelayUrls
      : Array.from(
          new Set(
            [sourceAnnouncement, provisionalAnnouncement].flatMap(
              (event) =>
                event?.tags
                  .find((tag) => tag[0] === "relays")
                  ?.slice(1)
                  .filter(Boolean) || []
            )
          )
        );
  const cloneUrls = Array.from(
    new Set([
      ...(record.sourceMetadata?.cloneUrls || []),
      ...verifiedTargets.map((target) => target.remoteUrl).filter(Boolean),
    ])
  ) as string[];
  const webUrls = Array.from(
    new Set([
      ...(record.sourceMetadata?.webUrls || []),
      ...verifiedTargets.map((target) => target.webUrl).filter(Boolean),
    ])
  ) as string[];
  const sourceCloneUrls = new Set(record.sourceMetadata?.cloneUrls || []);
  const authoritativeSourceCloneUrls =
    sourceAnnouncement?.tags.filter((tag) => tag[0] === "clone").flatMap((tag) => tag.slice(1)) ||
    [];
  const sourceWebUrls = new Set(record.sourceMetadata?.webUrls || []);
  const graspTargets = verifiedTargets.flatMap((target) =>
    target.provider === "grasp" && target.relayUrl && target.remoteUrl
      ? [{ relayUrl: target.relayUrl, cloneUrl: target.remoteUrl, webUrl: target.webUrl }]
      : []
  );
  const selectedGraspRelayKeys = new Set(
    record.targets
      .filter((target) => target.provider === "grasp" && target.relayUrl)
      .map((target) => normalizeRelayUrl(target.relayUrl as string))
  );
  const verifiedGraspRelayKeys = new Set(
    graspTargets.map((target) => normalizeRelayUrl(target.relayUrl))
  );
  const relays = sanitizeRelays([
    ...taggedRelays.filter((relay) => {
      const key = normalizeRelayUrl(relay);
      return !selectedGraspRelayKeys.has(key) || verifiedGraspRelayKeys.has(key);
    }),
    ...verifiedTargets.map((target) => target.relayUrl).filter(Boolean),
  ] as string[]);
  const { id: _id, sig: _sig, pubkey: _pubkey, ...announcementTemplate } = announcementBase;
  const preservedTags = announcementTemplate.tags.filter(
    (tag) => !["clone", "web", "relays"].includes(tag[0])
  );
  const reconciled = await reconcileRepoCreationEvents({
    relayUrls: relays,
    provisionalRelayUrls: record.publishedEvents.flatMap((item) => item.relayUrls),
    graspTargets,
    stateEvent,
    onPublishEvent: publisher,
    fetchRelayEvents: deps.fetchRelayEvents,
    provisionalEvents: getRepoCreationProvisionalEvents(record),
    onDeleteEvent: deps.onDeleteEvent,
    minCreatedAt: Math.max(
      sourceAnnouncement?.created_at || 0,
      provisionalAnnouncement?.created_at || 0,
      ...record.publishedEvents.map((item) => item.event.created_at)
    ),
    ownerPubkey: record.ownerPubkey,
    identifier: record.repoName,
    allowedUnlistedCloneUrls: authoritativeSourceCloneUrls,
    buildAnnouncement: ({ relays: nextRelays, graspCloneUrls, createdAt }) => {
      const retained = new Set([
        ...cloneUrls.filter(
          (url) =>
            sourceCloneUrls.has(url) || !graspTargets.some((target) => target.cloneUrl === url)
        ),
        ...graspCloneUrls,
      ]);
      const activeGraspWebUrls = graspTargets
        .filter((target) => graspCloneUrls.includes(target.cloneUrl))
        .map((target) => target.webUrl)
        .filter((url): url is string => Boolean(url));
      const retainedWebUrls = Array.from(
        new Set([
          ...webUrls.filter(
            (url) => sourceWebUrls.has(url) || !graspTargets.some((target) => target.webUrl === url)
          ),
          ...activeGraspWebUrls,
        ])
      );
      const built = {
        ...announcementTemplate,
        created_at: createdAt,
        tags: [
          ...preservedTags,
          ...(retainedWebUrls.length > 0 ? [["web", ...retainedWebUrls]] : []),
          ["clone", ...Array.from(retained)],
          ["relays", ...nextRelays],
        ],
      } as RepoAnnouncementEvent;
      const reuse =
        firstRound &&
        previousAnnouncement &&
        previousAnnouncement.content === built.content &&
        sameTags(previousAnnouncement.tags, built.tags);
      if (firstRound && previousAnnouncement && !reuse)
        journal.setMetadataAttempt({ stateEventId: stateEvent.id || undefined });
      firstRound = false;
      return reuse ? (previousAnnouncement as RepoAnnouncementEvent) : built;
    },
  });

  let next: RepoCreationRecoveryRecord = {
    ...journal.record,
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
      provisionalAnnouncementEvent: record.targetResults.find((result) => result.id === target.id)
        ?.provisionalAnnouncementEvent,
    })),
    pendingCompensations: reconciled.cleanupFailures,
    manualAttention:
      reconciled.cleanupFailures.length > 0
        ? { required: true, reason: "Metadata cleanup is pending" }
        : { required: false },
  };
  // Metadata has completed even if local cleanup is interrupted by a reload.
  next = persistRepoCreationRecoveryRecord({ ...next, phase: "cleanup-pending" });
  deps.assertCurrent?.();
  next = await cleanupLocalResource(next, deps.workerApi, deps.assertCurrent);
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

async function recoverRecord(
  record: RepoCreationRecoveryRecord,
  deps: RepoCreationRecoveryDependencies
): Promise<RepoCreationRecoveryResult> {
  const unknownWorkerOperation = record.workerOperations?.find(
    (operation) => operation.state === "unknown"
  );
  if (unknownWorkerOperation) {
    const pending = persistRepoCreationRecoveryRecord({
      ...record,
      manualAttention: {
        required: true,
        reason: `Worker operation ${unknownWorkerOperation.operationId} has an unknown outcome`,
      },
    });
    return { status: "pending", record: pending, reason: pending.manualAttention.reason };
  }

  if (
    record.phase === "metadata-pending" &&
    getLatestPublishedEvent(record, 30617) &&
    getLatestPublishedEvent(record, 30618)
  ) {
    try {
      await retryPendingRepoCreationMetadata(record, deps.publisher, deps.fetchRelayEvents);
    } catch (error) {
      if (
        !(error instanceof RepoCreationMetadataDeliveryError) ||
        ![30617, 30618].includes(error.event.kind)
      )
        throw error;
      let pending =
        getPendingRepoCreationTransactions().find((item) => item.id === record.id) || record;
      const verified = pending.targets.filter((target) => target.stage === "verified");
      const announcement =
        pending.sourceMetadata?.announcementEvent || getLatestPublishedEvent(pending, 30617)?.event;
      const savedState = getLatestPublishedEvent(pending, 30618)?.event;
      if (!announcement || !savedState || !verified.length) throw error;
      let observed: NostrEvent | undefined;
      try {
        const current = await readCurrentRecoveryAnnouncement(
          pending,
          announcement,
          deps.fetchRelayEvents
        );
        // Retain owner edits even if a later state/ref read fails or the next
        // metadata query omits them. This records evidence, never owner approval.
        if (current.id !== announcement.id)
          pending = persistRepoCreationRecoveryRecord({ ...pending, reviewAnnouncement: current });
        // Exact replay sends announcement first. A superseded announcement may be
        // rejected before state delivery is attempted; an unconfirmed failure must
        // still retry the same signed pair, not authorize a metadata replacement.
        if (error.event.kind === 30617 && !supersedes(current, error.event)) throw error;
        const { id: _id, sig: _sig, pubkey: _pubkey, ...unsigned } = savedState;
        const evidence = await assertRecoveryStateCurrent({
          record: pending,
          announcement: current,
          state: unsigned as ReturnType<typeof createRepoStateEvent>,
          targets: verified,
          fetchEvents: deps.fetchRelayEvents,
          listServerRefs: (params) => deps.workerApi.listServerRefs(params),
        });
        observed = evidence.observed;
        if (
          !observed ||
          !sameRecoveryStateContents(observed, savedState) ||
          !supersedes(observed, savedState)
        )
          throw error;
      } catch (cause) {
        // Read-only eligibility checks cannot convert an unresolved exact pair
        // into preparation. Keep its attempt/phase so ordinary exact replay still
        // works even if metadata or Git reads are unavailable on the next retry.
        const reason = cause instanceof Error ? cause.message : String(cause);
        const unresolved = persistRepoCreationRecoveryRecord({
          ...pending,
          ...(cause instanceof RepoRecoveryStateConflict && cause.stateEvent
            ? { stateConflictEvent: cause.stateEvent }
            : {}),
          manualAttention: { required: true, reason },
          lastError: reason,
        });
        return { status: "pending", record: unresolved, reason };
      }
      deps.assertCurrent?.();
      // A failed exact metadata retry and identical, superseding state establish
      // that the saved state is obsolete. Archive it unchanged; a separate attempt
      // still needs current owner metadata approval and live-ref verification.
      const preparing = persistRepoCreationRecoveryRecord({
        ...pending,
        phase: "metadata-preparing",
        stateConflictEvent: observed,
        metadataAttempt: { announcementEventId: getLatestPublishedEvent(pending, 30617)?.event.id },
      });
      return finalizeVerifiedTargets(preparing, verified, deps);
    }
    const persisted =
      getPendingRepoCreationTransactions().find((item) => item.id === record.id) || record;
    const next = await cleanupLocalResource(persisted, deps.workerApi, deps.assertCurrent);
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
    next = await cleanupLocalResource(next, deps.workerApi, deps.assertCurrent);
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

  const metadataOnly = ["metadata-preparing", "metadata-review", "metadata-pending"].includes(
    record.phase
  );
  const targets = await Promise.all(
    record.targets.map((target) =>
      // Keep historical proof intact. Unsigned state generation separately checks
      // current refs; an advanced branch must not become a failed-creation cleanup.
      target.stage === "verified" ? target : probeTarget(record, target, deps)
    )
  );
  record = persistRepoCreationRecoveryRecord({ ...record, targets });
  const verified = targets.filter((target) => target.stage === "verified");
  const unknown = targets.filter((target) => target.stage === "unknown");
  if (verified.length > 0) {
    return finalizeVerifiedTargets({ ...record, targets }, verified, deps);
  }

  if (metadataOnly) {
    const reason =
      "Metadata preparation needs verified target receipts. Completed resources were retained; retry when verification is available.";
    const pending = persistRepoCreationRecoveryRecord({
      ...record,
      manualAttention: { required: true, reason },
    });
    return { status: "pending", record: pending, reason };
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
      deps.workerApi,
      deps.assertCurrent
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

export async function recoverRepoCreationRecord(
  record: RepoCreationRecoveryRecord,
  deps: RepoCreationRecoveryDependencies
): Promise<RepoCreationRecoveryResult> {
  const release = reserveRepoCreation(record.ownerPubkey, record.repoName);
  try {
    deps.assertCurrent?.();
    // Validate the entire persisted inventory before any replay or cleanup. Bad
    // legacy records remain durable, never "repaired" by changing a signed d.
    const recorded = [
      ...record.publishedEvents.map((item) => item.event),
      ...record.targets.flatMap((target) =>
        target.announcementEvent ? [target.announcementEvent] : []
      ),
      ...record.targetResults.flatMap((target) =>
        target.provisionalAnnouncementEvent ? [target.provisionalAnnouncementEvent] : []
      ),
      ...(record.sourceMetadata?.announcementEvent
        ? [record.sourceMetadata.announcementEvent]
        : []),
    ];
    for (const event of recorded) assertRepoCreationEvent(record, event, true);
    const publisher = scopeRepoCreationPublisher(record, deps.publisher);
    return await recoverRecord(record, {
      ...deps,
      publisher: (event, context) => {
        deps.assertCurrent?.();
        return publisher(event, {
          ...context,
          relays: context?.relays || [],
          assertCurrent: () => {
            deps.assertCurrent?.();
            context?.assertCurrent?.();
          },
        });
      },
      onDeleteEvent: (event, relays) => {
        deps.assertCurrent?.();
        assertRepoCreationEvent(record, event, true);
        return deps.onDeleteEvent(event, relays);
      },
    });
  } catch (error) {
    const persisted =
      getPendingRepoCreationTransactions().find((item) => item.id === record.id) || record;
    const review = error instanceof RepoMetadataReviewRequired;
    const stateConflict = error instanceof RepoRecoveryStateConflict;
    const reason = error instanceof Error ? error.message : String(error);
    const pending = persistRepoCreationRecoveryRecord({
      ...persisted,
      phase: review ? "metadata-review" : stateConflict ? "metadata-preparing" : persisted.phase,
      ...(review ? { reviewAnnouncement: error.announcement || persisted.reviewAnnouncement } : {}),
      ...(stateConflict
        ? { stateConflictEvent: error.stateEvent || persisted.stateConflictEvent }
        : {}),
      manualAttention: { required: true, reason },
      lastError: reason,
    });
    return { status: "pending", record: pending, reason };
  } finally {
    release();
  }
}
