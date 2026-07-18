import {
  createRepoAnnouncementEvent,
  createRepoStateEvent,
  type RepoAnnouncementEvent,
  type RepoCommunityBinding,
  type RepoStateEvent,
} from "@nostr-git/core/events";
import type { NostrEvent, NostrFilter } from "@nostr-git/core";
import { isGraspRepoHttpUrl, sanitizeRelays } from "@nostr-git/core/utils";
import { nip19 } from "nostr-tools";
import { checkGraspRepoExists, checkGraspReceivePackReady } from "./grasp-availability.js";

export interface GraspPublishRelayAck {
  ackedRelays: string[];
  failedRelays: string[];
  successCount: number;
  hasRelayOutcomes: boolean;
  relayOutcomes?: PublishRepoRelayOutcome[];
}

export interface PublishRepoRelayOutcome {
  relay: string;
  status: string;
  detail: string;
}

export interface RepoCreationGraspTarget {
  relayUrl: string;
  cloneUrl: string;
}

export interface RepoCreationProvisionalEvent {
  event: NostrEvent;
  relayUrls: string[];
}

export type DeleteRepoEvent = (event: NostrEvent, relayUrls: string[]) => Promise<void> | void;

export interface ReconcileRepoCreationEventsParams {
  relayUrls: string[];
  provisionalRelayUrls?: string[];
  graspTargets?: RepoCreationGraspTarget[];
  stateEvent: RepoStateEvent | NostrEvent;
  onPublishEvent: PublishRepoEvent;
  buildAnnouncement: (params: {
    relays: string[];
    graspRelayUrls: string[];
    graspCloneUrls: string[];
    createdAt: number;
  }) => RepoAnnouncementEvent;
  fetchRelayEvents?: FetchRelayEvents;
  provisionalEvents?: RepoCreationProvisionalEvent[];
  onDeleteEvent?: DeleteRepoEvent;
  minCreatedAt?: number;
  maxRounds?: number;
}

export interface ReconciledRepoCreationEvents {
  announcementEvent: NostrEvent;
  stateEvent: NostrEvent;
  relays: string[];
  graspRelayUrls: string[];
  graspCloneUrls: string[];
  removedRelays: string[];
  cleanupFailures: Array<{
    action: "delete" | "republish";
    eventId: string;
    relayUrls: string[];
    error: string;
  }>;
}

export interface PublishRepoEventContext {
  relays: string[];
  stage?: "provisional" | "final";
}

export interface PublishRepoEventResult {
  event: NostrEvent;
  ackedRelays: string[];
  failedRelays: string[];
  successCount?: number;
  hasRelayOutcomes?: boolean;
  relayOutcomes?: PublishRepoRelayOutcome[];
}

export type PublishRepoEvent = (
  event: RepoAnnouncementEvent | RepoStateEvent | NostrEvent,
  context?: PublishRepoEventContext
) => Promise<PublishRepoEventResult> | PublishRepoEventResult;

export interface PublishedGraspEvent {
  event: NostrEvent;
  relayAck: GraspPublishRelayAck;
}

export interface PublishGraspEventWithRetryParams {
  relayUrl: string;
  event: RepoAnnouncementEvent | RepoStateEvent | NostrEvent;
  onPublishEvent: PublishRepoEvent;
  publishRelays: string[];
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface FetchRelayEventsParams {
  relays: string[];
  filters: NostrFilter[];
  timeoutMs?: number;
  throwOnTimeout?: boolean;
}

export type FetchRelayEvents = (params: FetchRelayEventsParams) => Promise<NostrEvent[]>;

export interface VerifyGraspEventAfterPushParams {
  relayUrl: string;
  event: NostrEvent;
  fetchRelayEvents: FetchRelayEvents;
  visibilityTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface PublishGraspRepoStateAndWaitParams {
  relayUrl: string;
  stateEvent: RepoStateEvent;
  onPublishEvent: PublishRepoEvent;
  publishRelays?: string[];
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface PublishGraspRepoStateForPushParams {
  remoteUrl: string;
  branch: string;
  commitSha: string;
  authorPubkey: string;
  fallbackRepoName?: string;
  onPublishEvent: PublishRepoEvent;
  publishRelays?: string[];
  maxAttempts?: number;
  retryDelayMs?: number;
  fetchRelayEvents: FetchRelayEvents;
}

export interface FetchLatestGraspRepoStateParams {
  relayUrl: string;
  repoName: string;
  fetchRelayEvents?: FetchRelayEvents;
  authorPubkey?: string;
  timeoutMs?: number;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeRelayForCompare(relay: string): string {
  const trimmed = String(relay || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

export function extractPublishRelayAck(result: unknown): GraspPublishRelayAck {
  const ackedRelays = new Set<string>();
  const failedRelays = new Set<string>();
  const relayOutcomes = new Map<string, PublishRepoRelayOutcome>();

  if (result && typeof result === "object") {
    const value = result as any;

    if (Array.isArray(value.ackedRelays)) {
      for (const relay of value.ackedRelays) {
        const normalized = normalizeRelayForCompare(String(relay || ""));
        if (normalized) ackedRelays.add(normalized);
      }
    }

    if (Array.isArray(value.failedRelays)) {
      for (const relay of value.failedRelays) {
        const normalized = normalizeRelayForCompare(String(relay || ""));
        if (normalized) failedRelays.add(normalized);
      }
    }

    if (Array.isArray(value.relayOutcomes)) {
      for (const rawOutcome of value.relayOutcomes) {
        if (!rawOutcome || typeof rawOutcome !== "object") continue;
        const relay = normalizeRelayForCompare(String(rawOutcome.relay || ""));
        if (!relay) continue;

        const outcome = {
          relay,
          status: String(rawOutcome.status || "unknown"),
          detail: String(rawOutcome.detail || ""),
        };
        relayOutcomes.set(relay, outcome);

        if (outcome.status === "success") {
          ackedRelays.add(relay);
        } else {
          failedRelays.add(relay);
        }
      }
    }
  }

  for (const relay of ackedRelays) {
    failedRelays.delete(relay);
  }

  return {
    ackedRelays: Array.from(ackedRelays),
    failedRelays: Array.from(failedRelays),
    successCount: ackedRelays.size,
    hasRelayOutcomes: ackedRelays.size + failedRelays.size + relayOutcomes.size > 0,
    ...(relayOutcomes.size > 0 ? { relayOutcomes: Array.from(relayOutcomes.values()) } : {}),
  };
}

function intersectRelays(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((relay) => setB.has(relay));
}

function sameRelaySet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const normalizedB = new Set(b.map(normalizeRelayForCompare));
  return a.every((relay) => normalizedB.has(normalizeRelayForCompare(relay)));
}

function filterAckedRelays(relays: string[], ack: GraspPublishRelayAck): string[] {
  return relays.filter((relay) => didRelayAckGraspEvents(ack, relay));
}

function describeRelayFailures(ack: GraspPublishRelayAck): string {
  if (ack.relayOutcomes?.length) {
    return ack.relayOutcomes
      .filter((outcome) => outcome.status !== "success")
      .map((outcome) => `${outcome.relay}: ${outcome.detail || outcome.status}`)
      .join("; ");
  }

  return ack.failedRelays.join(", ");
}

function normalizeRelayOrigin(relayUrl: string): string {
  return normalizeGraspOrigins(relayUrl).wsOrigin.replace(/\/+$/, "");
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function canDeriveMandatoryGraspRelay(input: string): boolean {
  const trimmed = String(input || "").trim();
  if (!trimmed) return false;
  if (isGraspRepoHttpUrl(trimmed)) return true;

  const knownPlatformHosts = ["github.com", "gitlab.com", "bitbucket.org"];
  if (knownPlatformHosts.includes(trimmed.split(":")[0].toLowerCase())) return false;

  try {
    const url = new URL(trimmed);
    if (url.protocol === "ws:" || url.protocol === "wss:") return true;
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (knownPlatformHosts.includes(url.hostname.toLowerCase())) {
      return false;
    }

    const pathSegments = url.pathname.split("/").filter(Boolean);
    if (pathSegments.length === 0) return true;

    // Allow GRASP server API roots like https://relay.example/api, but not
    // platform clone URLs such as https://github.com/owner/repo.git.
    return pathSegments.length === 1 && !pathSegments[0].endsWith(".git");
  } catch {
    return /^[^/\s]+(?::\d+)?$/.test(trimmed);
  }
}

export function getMandatoryGraspRelayUrls(relayUrls: string[] = []): string[] {
  return dedupeStrings(
    relayUrls
      .map((relayUrl) => {
        try {
          if (!canDeriveMandatoryGraspRelay(relayUrl)) return "";
          return normalizeGraspOrigins(relayUrl).wsOrigin;
        } catch {
          return "";
        }
      })
      .filter(Boolean)
  );
}

export function getEditableRepoRelayUrls(
  relayUrls: string[] = [],
  mandatoryGraspRelayUrls: string[] = []
): string[] {
  const mandatoryRelaySet = new Set(getMandatoryGraspRelayUrls(mandatoryGraspRelayUrls));

  return sanitizeRelays(relayUrls).filter((relayUrl) => !mandatoryRelaySet.has(relayUrl));
}

export function getEffectiveRepoRelayUrls(
  relayUrls: string[] = [],
  mandatoryGraspRelayUrls: string[] = []
): string[] {
  return sanitizeRelays([
    ...getEditableRepoRelayUrls(relayUrls, mandatoryGraspRelayUrls),
    ...getMandatoryGraspRelayUrls(mandatoryGraspRelayUrls),
  ]);
}

export function getSuccessfulGraspRelayUrls(remoteUrls: string[] = []): string[] {
  return dedupeStrings(
    remoteUrls
      .filter((remoteUrl) => isGraspRepoHttpUrl(remoteUrl))
      .map((remoteUrl) => normalizeGraspOrigins(remoteUrl).wsOrigin)
      .filter(Boolean)
  );
}

function parseGraspPushTarget(
  remoteUrl: string,
  fallbackRepoName = ""
): {
  relayUrl: string;
  repoName: string;
} {
  const parsed = new URL(remoteUrl);
  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  const repoSegment = pathSegments[pathSegments.length - 1] || fallbackRepoName;
  const encodedRepoName = repoSegment.replace(/\.git$/i, "");
  let repoName = encodedRepoName;
  try {
    repoName = decodeURIComponent(encodedRepoName);
  } catch {
    // Keep the literal segment so malformed third-party URLs still produce a useful error path.
  }

  if (!repoName) {
    throw new Error(`Could not determine repository name from ${remoteUrl}`);
  }

  return {
    relayUrl: normalizeRelayOrigin(remoteUrl),
    repoName,
  };
}

export function didRelayAckGraspEvents(ack: GraspPublishRelayAck, relayUrl: string): boolean {
  const { wsOrigin, httpOrigin } = normalizeGraspOrigins(relayUrl);
  const targetVariants = new Set([
    normalizeRelayForCompare(relayUrl),
    normalizeRelayForCompare(wsOrigin),
    normalizeRelayForCompare(httpOrigin),
  ]);

  return ack.ackedRelays.some((relay) => targetVariants.has(normalizeRelayForCompare(relay)));
}

function getPublishedEvent(result: unknown): NostrEvent | undefined {
  if (!result || typeof result !== "object") return undefined;
  const event = (result as { event?: NostrEvent }).event;
  return event &&
    typeof event.id === "string" &&
    event.id.trim() &&
    typeof event.pubkey === "string" &&
    event.pubkey.trim() &&
    typeof event.sig === "string" &&
    event.sig.trim()
    ? event
    : undefined;
}

function tagsEqual(a: string[][] | undefined, b: string[][] | undefined): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every(
    (tag, index) =>
      Array.isArray(tag) &&
      Array.isArray(b[index]) &&
      tag.length === b[index].length &&
      tag.every((value, valueIndex) => value === b[index][valueIndex])
  );
}

function eventMatchesExpectedCore(
  event: NostrEvent,
  expected: RepoAnnouncementEvent | RepoStateEvent | NostrEvent,
  expectedTags: string[][] = expected.tags
): boolean {
  if (
    event.kind !== expected.kind ||
    event.created_at !== expected.created_at ||
    event.content !== expected.content ||
    !tagsEqual(event.tags, expectedTags)
  ) {
    return false;
  }

  for (const field of ["id", "pubkey", "sig"] as const) {
    const expectedValue = expected[field];
    if (typeof expectedValue === "string" && expectedValue && event[field] !== expectedValue) {
      return false;
    }
  }

  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function describeSelectedRelayFailure(ack: GraspPublishRelayAck, relayUrl: string): string {
  const target = normalizeRelayOrigin(relayUrl);
  const outcome = ack.relayOutcomes?.find(
    (candidate) => normalizeRelayForCompare(candidate.relay) === target
  );

  if (!outcome) return `selected relay ${target} did not ACK the event`;
  return `selected relay ${target} returned ${outcome.status}${
    outcome.detail ? ` (${outcome.detail})` : ""
  }`;
}

function snapshotEvent<T extends RepoAnnouncementEvent | RepoStateEvent | NostrEvent>(event: T): T {
  return { ...event, tags: event.tags.map((tag) => [...tag]) } as T;
}

export async function publishGraspEventWithRetry({
  relayUrl,
  event,
  onPublishEvent,
  publishRelays,
  maxAttempts = 3,
  retryDelayMs = 500,
}: PublishGraspEventWithRetryParams): Promise<PublishedGraspEvent> {
  const attempts = Math.max(1, Math.floor(maxAttempts));
  const context: PublishRepoEventContext = { relays: publishRelays };
  const originalEvent = snapshotEvent(event);
  const inputSignedEvent = getPublishedEvent({ event });
  let signedEvent: NostrEvent | undefined = inputSignedEvent;
  let signedEventSnapshot: NostrEvent | undefined = inputSignedEvent
    ? snapshotEvent(inputSignedEvent)
    : undefined;
  let lastFailure = "selected relay did not return an outcome";
  const attemptFailures: string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await onPublishEvent(signedEvent || event, context);
      const resultEvent = getPublishedEvent(result) || signedEvent;
      let resultMatchesSignedEvent = false;

      if (!resultEvent) {
        lastFailure = "publish result did not include a signed event with an id";
        if (!signedEvent) throw new Error(lastFailure);
      } else if (!signedEvent) {
        if (!eventMatchesExpectedCore(resultEvent, originalEvent)) {
          throw new Error("signed event changed the GRASP event core fields or tags");
        }
        signedEvent = resultEvent;
        signedEventSnapshot = snapshotEvent(resultEvent);
        resultMatchesSignedEvent = true;
      } else {
        resultMatchesSignedEvent = Boolean(
          signedEventSnapshot &&
          resultEvent.id === signedEventSnapshot.id &&
          eventMatchesExpectedCore(resultEvent, signedEventSnapshot)
        );
        if (!resultMatchesSignedEvent) {
          lastFailure = "publish retry returned a different signed event";
        }
      }

      const relayAck = extractPublishRelayAck(result);
      if (resultEvent && signedEvent && resultMatchesSignedEvent) {
        if (!relayAck.hasRelayOutcomes) {
          lastFailure = "publish result did not include relay outcomes";
        } else if (!didRelayAckGraspEvents(relayAck, relayUrl)) {
          lastFailure = describeSelectedRelayFailure(relayAck, relayUrl);
        } else {
          return { event: signedEvent, relayAck };
        }
      }
    } catch (error) {
      lastFailure = errorMessage(error);
      if (!signedEvent) {
        throw new Error(
          `GRASP publish failed before a signed event was returned; exact retry is unavailable: ${lastFailure}`
        );
      }
    }

    attemptFailures.push(`attempt ${attempt}: ${lastFailure}`);

    if (attempt < attempts && retryDelayMs > 0) {
      await delay(retryDelayMs);
    }
  }

  throw new Error(
    `GRASP event ${signedEvent?.id || event.kind} failed after ${attempts} publish attempt${attempts === 1 ? "" : "s"}: ${attemptFailures.join("; ") || lastFailure}`
  );
}

export async function reconcileRepoCreationEvents({
  relayUrls,
  provisionalRelayUrls = [],
  graspTargets = [],
  stateEvent,
  onPublishEvent,
  buildAnnouncement,
  fetchRelayEvents,
  provisionalEvents = [],
  onDeleteEvent,
  minCreatedAt = 0,
  maxRounds = 3,
}: ReconcileRepoCreationEventsParams): Promise<ReconciledRepoCreationEvents> {
  const allCandidateRelays = dedupeStrings([
    ...relayUrls.map(normalizeRelayOrigin),
    ...provisionalRelayUrls.map(normalizeRelayOrigin),
  ]);
  let activeRelays = dedupeStrings(relayUrls.map(normalizeRelayOrigin));
  let signedStateEvent = getPublishedEvent({ event: stateEvent });
  let finalAnnouncement: NostrEvent | undefined;
  let finalState: NostrEvent | undefined;
  let finalGraspTargets: RepoCreationGraspTarget[] = [];
  let createdAt = Math.max(Math.floor(Date.now() / 1000), minCreatedAt + 1);
  const rounds = Math.max(1, Math.floor(maxRounds));
  const obsoleteEvents: RepoCreationProvisionalEvent[] = provisionalEvents.map((item) => ({
    event: item.event,
    relayUrls: dedupeStrings(item.relayUrls.map(normalizeRelayOrigin)),
  }));

  if (activeRelays.length === 0) {
    throw new Error("Repository creation requires at least one candidate relay");
  }

  for (let round = 1; round <= rounds; round++) {
    const activeRelaySet = new Set(activeRelays.map(normalizeRelayForCompare));
    const activeGraspTargets = graspTargets.filter((target) =>
      activeRelaySet.has(normalizeRelayForCompare(normalizeRelayOrigin(target.relayUrl)))
    );
    const announcementTemplate = buildAnnouncement({
      relays: activeRelays,
      graspRelayUrls: activeGraspTargets.map((target) => normalizeRelayOrigin(target.relayUrl)),
      graspCloneUrls: activeGraspTargets.map((target) => target.cloneUrl),
      createdAt,
    });
    const announcementResult = await onPublishEvent(announcementTemplate, {
      relays: activeRelays,
      stage: "final",
    });
    const signedAnnouncement = getPublishedEvent(announcementResult);
    if (!signedAnnouncement) {
      throw new Error("Final repository announcement publication did not return a signed event");
    }
    obsoleteEvents.push({ event: signedAnnouncement, relayUrls: [...activeRelays] });

    const announcementAck = extractPublishRelayAck(announcementResult);
    const announcementRelays = filterAckedRelays(activeRelays, announcementAck);
    if (announcementRelays.length === 0) {
      // Persist a signed state as well so exact-pair recovery remains possible.
      if (!signedStateEvent) {
        try {
          const signedStateResult = await onPublishEvent(stateEvent, {
            relays: [],
            stage: "final",
          });
          signedStateEvent = getPublishedEvent(signedStateResult);
        } catch {
          // Preserve the announcement failure as the actionable error.
        }
      }

      const details = describeRelayFailures(announcementAck);
      throw new Error(
        `No candidate relay ACKed the final repository announcement${details ? ` (${details})` : ""}`
      );
    }

    const stateResult = await onPublishEvent(signedStateEvent || stateEvent, {
      relays: announcementRelays,
      stage: "final",
    });
    signedStateEvent = getPublishedEvent(stateResult) || signedStateEvent;
    if (!signedStateEvent) {
      throw new Error("Final repository state publication did not return a signed event");
    }

    const stateAck = extractPublishRelayAck(stateResult);
    let nextRelays = filterAckedRelays(announcementRelays, stateAck);
    if (nextRelays.length === 0) {
      const details = describeRelayFailures(stateAck);
      throw new Error(
        `No candidate relay ACKed both final repository events${details ? ` (${details})` : ""}`
      );
    }

    if (sameRelaySet(nextRelays, activeRelays) && fetchRelayEvents) {
      const verifiedGraspRelays: string[] = [];
      for (const target of activeGraspTargets) {
        const targetRelay = normalizeRelayOrigin(target.relayUrl);
        try {
          await verifyGraspEventAfterPush({
            relayUrl: targetRelay,
            event: signedAnnouncement,
            fetchRelayEvents,
          });
          await verifyGraspEventAfterPush({
            relayUrl: targetRelay,
            event: signedStateEvent,
            fetchRelayEvents,
          });
          verifiedGraspRelays.push(targetRelay);
        } catch {
          nextRelays = nextRelays.filter(
            (relay) => normalizeRelayForCompare(relay) !== normalizeRelayForCompare(targetRelay)
          );
        }
      }

      if (
        activeGraspTargets.length > 0 &&
        verifiedGraspRelays.length === 0 &&
        nextRelays.length === 0
      ) {
        throw new Error("No GRASP relay exposed both final repository events after push");
      }
    }

    if (nextRelays.length > 0 && sameRelaySet(nextRelays, activeRelays)) {
      const cloneUrls = signedAnnouncement.tags.find((tag) => tag[0] === "clone")?.slice(1) || [];
      if (cloneUrls.length === 0) {
        throw new Error("Final repository announcement has no verified clone URL");
      }
      finalAnnouncement = signedAnnouncement;
      finalState = signedStateEvent;
      finalGraspTargets = activeGraspTargets;
      activeRelays = nextRelays;
      break;
    }

    activeRelays = nextRelays;
    createdAt += 1;
  }

  if (!finalAnnouncement || !finalState) {
    throw new Error(`Repository relay set did not stabilize after ${rounds} rounds`);
  }

  const activeRelaySet = new Set(activeRelays.map(normalizeRelayForCompare));
  const removedRelays = allCandidateRelays.filter(
    (relay) => !activeRelaySet.has(normalizeRelayForCompare(relay))
  );

  const cleanupFailures: ReconciledRepoCreationEvents["cleanupFailures"] = [];
  // A removed GRASP service rejects this replacement but applies de-list cleanup first.
  await Promise.all(
    removedRelays.map(async (relay) => {
      try {
        const result = await onPublishEvent(finalAnnouncement as NostrEvent, {
          relays: [relay],
          stage: "final",
        });
        const ack = extractPublishRelayAck(result);
        const outcome = ack.relayOutcomes?.find(
          (item) => normalizeRelayForCompare(item.relay) === normalizeRelayForCompare(relay)
        );
        const expectedDelistRejection = /service.*not listed|not listed|service.*omitted/i.test(
          outcome?.detail || ""
        );
        if (!didRelayAckGraspEvents(ack, relay) && !expectedDelistRejection) {
          cleanupFailures.push({
            action: "republish",
            eventId: finalAnnouncement.id,
            relayUrls: [relay],
            error: outcome?.detail || `Final de-list replacement was not acknowledged by ${relay}`,
          });
        }
      } catch (error) {
        cleanupFailures.push({
          action: "republish",
          eventId: finalAnnouncement.id,
          relayUrls: [relay],
          error: errorMessage(error),
        });
      }
    })
  );

  if (onDeleteEvent) {
    const finalEventIds = new Set([finalAnnouncement.id, finalState.id]);
    const cleanupByEvent = new Map<string, RepoCreationProvisionalEvent>();
    for (const item of obsoleteEvents) {
      if (!item.event?.id || finalEventIds.has(item.event.id)) continue;
      const existing = cleanupByEvent.get(item.event.id);
      cleanupByEvent.set(item.event.id, {
        event: item.event,
        relayUrls: dedupeStrings([...(existing?.relayUrls || []), ...item.relayUrls]),
      });
    }

    await Promise.all(
      Array.from(cleanupByEvent.values()).map(async (item) => {
        try {
          await onDeleteEvent(item.event, item.relayUrls);
        } catch (error) {
          cleanupFailures.push({
            action: "delete",
            eventId: item.event.id,
            relayUrls: item.relayUrls,
            error: errorMessage(error),
          });
        }
      })
    );
  }

  return {
    announcementEvent: finalAnnouncement,
    stateEvent: finalState,
    relays: activeRelays,
    graspRelayUrls: finalGraspTargets.map((target) => normalizeRelayOrigin(target.relayUrl)),
    graspCloneUrls: finalGraspTargets.map((target) => target.cloneUrl),
    removedRelays,
    cleanupFailures,
  };
}

async function pollForExactGraspEvent(params: {
  relayUrl: string;
  event: NostrEvent;
  fetchRelayEvents: FetchRelayEvents;
  visibilityTimeoutMs: number;
  pollIntervalMs: number;
}): Promise<{ visible: boolean; confirmedAbsent: boolean; lastError?: string }> {
  const deadline = Date.now() + Math.max(0, params.visibilityTimeoutMs);
  let completedRead = false;
  let lastError = "";

  while (true) {
    try {
      const remainingMs = Math.max(0, deadline - Date.now());
      const events = await params.fetchRelayEvents({
        relays: [normalizeRelayOrigin(params.relayUrl)],
        filters: [{ ids: [params.event.id] }],
        ...(params.visibilityTimeoutMs > 0
          ? { timeoutMs: Math.max(1, Math.min(2500, remainingMs || 1)) }
          : {}),
        throwOnTimeout: true,
      });
      completedRead = true;

      if (
        events.some(
          (candidate) =>
            candidate?.id === params.event.id && eventMatchesExpectedCore(candidate, params.event)
        )
      ) {
        return { visible: true, confirmedAbsent: false };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return {
        visible: false,
        confirmedAbsent: completedRead,
        ...(lastError ? { lastError } : {}),
      };
    }
    if (params.pollIntervalMs > 0) {
      await delay(Math.min(params.pollIntervalMs, remainingMs));
    }
  }
}

export async function verifyGraspEventAfterPush({
  relayUrl,
  event,
  fetchRelayEvents,
  visibilityTimeoutMs = 10000,
  pollIntervalMs = 500,
}: VerifyGraspEventAfterPushParams): Promise<NostrEvent> {
  if (!fetchRelayEvents) {
    throw new Error("Post-push GRASP verification requires fetchRelayEvents");
  }
  if (!event?.id) {
    throw new Error("Post-push GRASP verification requires a signed event with an id");
  }

  const pollParams = {
    relayUrl,
    event,
    fetchRelayEvents,
    visibilityTimeoutMs,
    pollIntervalMs,
  };

  const result = await pollForExactGraspEvent(pollParams);
  if (result.visible) return event;

  if (!result.confirmedAbsent) {
    throw new Error(
      `GRASP event ${event.id} could not be verified on ${normalizeRelayOrigin(relayUrl)}${
        result.lastError ? ` (${result.lastError})` : ""
      }`
    );
  }

  throw new Error(
    `GRASP event ${event.id} was absent after completed post-push queries on ${normalizeRelayOrigin(relayUrl)}`
  );
}

export interface GraspRef {
  type: "heads" | "tags";
  name: string;
  commit: string;
  ancestry?: string[];
}

function parseGraspFullRef(fullRef: string): { type: "heads" | "tags"; name: string } | null {
  const match = /^refs\/(heads|tags)\/(.+)$/.exec(fullRef);
  if (!match) return null;
  if (match[1] === "tags" && match[2].endsWith("^{}")) return null;

  return { type: match[1] as "heads" | "tags", name: match[2] };
}

export function getGraspRefFullName(ref: Pick<GraspRef, "type" | "name">): string {
  return `refs/${ref.type}/${ref.name}`;
}

export function getGraspStateRefsFromEvent(event?: NostrEvent | RepoStateEvent): GraspRef[] {
  if (!event || !Array.isArray(event.tags)) return [];

  const refs: GraspRef[] = [];
  for (const tag of event.tags) {
    const fullRef = String(tag?.[0] || "");
    if (!fullRef.startsWith("refs/")) continue;

    const parsed = parseGraspFullRef(fullRef);
    const commit = String(tag?.[1] || "").trim();
    if (!parsed || !commit) continue;

    const ancestry = tag.slice(2).filter((value): value is string => typeof value === "string");
    refs.push({ ...parsed, commit, ...(ancestry.length > 0 ? { ancestry } : {}) });
  }

  return refs;
}

export function getGraspStateHeadFromEvent(
  event?: NostrEvent | RepoStateEvent
): string | undefined {
  if (!event || !Array.isArray(event.tags)) return undefined;

  const headValue = String(event.tags.find((tag) => tag?.[0] === "HEAD")?.[1] || "").trim();
  const fullRef = headValue.startsWith("ref: ") ? headValue.slice("ref: ".length) : headValue;
  const parsed = parseGraspFullRef(fullRef);
  return parsed?.type === "heads" ? parsed.name : undefined;
}

export function createGraspRefMap(refs: GraspRef[] = []): Map<string, GraspRef> {
  const map = new Map<string, GraspRef>();
  for (const ref of refs) {
    const fullRef = getGraspRefFullName(ref);
    map.set(fullRef, ref);
  }
  return map;
}

export function mergeGraspRefs(baseRefs: GraspRef[] = [], updates: GraspRef[] = []): GraspRef[] {
  const refsByFullRef = createGraspRefMap(baseRefs);
  for (const update of updates) {
    if (!update.commit) continue;
    refsByFullRef.set(getGraspRefFullName(update), update);
  }
  return Array.from(refsByFullRef.values());
}

export function resolveGraspStateHead(params: {
  existingHead?: string;
  refs: GraspRef[];
  fallbackHead?: string;
  preferFallback?: boolean;
}): string | undefined {
  const heads = new Set(params.refs.filter((ref) => ref.type === "heads").map((ref) => ref.name));
  if (params.preferFallback && params.fallbackHead && heads.has(params.fallbackHead)) {
    return params.fallbackHead;
  }
  if (params.existingHead && heads.has(params.existingHead)) return params.existingHead;
  if (params.fallbackHead && heads.has(params.fallbackHead)) return params.fallbackHead;
  return heads.values().next().value;
}

export function createGraspStateEventFromExistingState(params: {
  repoId: string;
  currentState?: NostrEvent | RepoStateEvent;
  head?: string;
  created_at?: number;
}): RepoStateEvent | undefined {
  const refs = getGraspStateRefsFromEvent(params.currentState);
  if (refs.length === 0) return undefined;

  const head = resolveGraspStateHead({
    existingHead: getGraspStateHeadFromEvent(params.currentState),
    refs,
    fallbackHead: params.head,
    preferFallback: Boolean(params.head),
  });

  return createRepoStateEvent({
    repoId: params.repoId,
    refs,
    head,
    created_at: params.created_at,
  });
}

export async function fetchLatestGraspRepoStateEvent({
  relayUrl,
  repoName,
  fetchRelayEvents,
  authorPubkey,
  timeoutMs = 2500,
}: FetchLatestGraspRepoStateParams): Promise<NostrEvent | undefined> {
  if (!fetchRelayEvents) return undefined;

  const normalizedRelayUrl = normalizeRelayOrigin(relayUrl);
  const filter: NostrFilter = {
    kinds: [30618],
    "#d": [repoName],
    limit: 20,
  };

  if (authorPubkey) {
    filter.authors = [authorPubkey];
  }

  const events = await fetchRelayEvents({
    relays: [normalizedRelayUrl],
    filters: [filter],
    timeoutMs,
  });

  return events
    .filter((event) => event?.kind === 30618)
    .filter((event) => !authorPubkey || event.pubkey === authorPubkey)
    .filter((event) =>
      Array.isArray(event.tags)
        ? event.tags.some((tag) => tag?.[0] === "d" && String(tag?.[1] || "") === repoName)
        : false
    )
    .sort((a, b) => {
      const createdAtDiff = (b.created_at || 0) - (a.created_at || 0);
      if (createdAtDiff !== 0) return createdAtDiff;
      return String(a.id || "").localeCompare(String(b.id || ""));
    })
    .at(0);
}

export function normalizeGraspOrigins(input: string): { wsOrigin: string; httpOrigin: string } {
  try {
    const url = new URL(input);
    const host = url.host;
    const isSecure = url.protocol === "wss:" || url.protocol === "https:";
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const ownerIndex = pathSegments.findIndex((segment) => segment.startsWith("npub1"));
    const baseSegments = ownerIndex >= 0 ? pathSegments.slice(0, ownerIndex) : pathSegments;
    const basePath = baseSegments.length > 0 ? `/${baseSegments.join("/")}` : "";
    return {
      wsOrigin: `${isSecure ? "wss" : "ws"}://${host}${basePath}`,
      httpOrigin: `${isSecure ? "https" : "http"}://${host}${basePath}`,
    };
  } catch {
    const hostMatch = input.match(/(?:ws|wss|http|https):\/\/([^/]+)/);
    if (hostMatch) {
      const host = hostMatch[1];
      const isSecure = input.startsWith("wss://") || input.startsWith("https://");
      return {
        wsOrigin: isSecure ? `wss://${host}` : `ws://${host}`,
        httpOrigin: isSecure ? `https://${host}` : `http://${host}`,
      };
    }

    const host = input.replace(/^\/\//, "");
    return {
      wsOrigin: `wss://${host}`,
      httpOrigin: `https://${host}`,
    };
  }
}

export function toNpubOrSelf(value: string): string {
  if (value.startsWith("npub1")) return value;
  return nip19.npubEncode(value);
}

export function buildGraspRepoUrls(params: {
  relayUrls: string[];
  ownerPubkey: string;
  repoName: string;
}): { ownerNpub: string; cloneUrls: string[]; webUrls: string[] } {
  const { relayUrls, ownerPubkey, repoName } = params;
  const ownerNpub = toNpubOrSelf(ownerPubkey);
  const encodedRepoName = encodeURIComponent(repoName);
  const cloneUrls: string[] = [];
  const webUrls: string[] = [];
  const seenCloneUrls = new Set<string>();
  const seenWebUrls = new Set<string>();

  for (const relayUrl of relayUrls) {
    const trimmed = String(relayUrl || "").trim();
    if (!trimmed) continue;

    const { httpOrigin } = normalizeGraspOrigins(trimmed);
    const webUrl = `${httpOrigin}/${ownerNpub}/${encodedRepoName}`;
    const cloneUrl = `${webUrl}.git`;

    if (!seenWebUrls.has(webUrl)) {
      seenWebUrls.add(webUrl);
      webUrls.push(webUrl);
    }

    if (!seenCloneUrls.has(cloneUrl)) {
      seenCloneUrls.add(cloneUrl);
      cloneUrls.push(cloneUrl);
    }
  }

  return { ownerNpub, cloneUrls, webUrls };
}

export interface CreateGraspEventsParams {
  relayUrl: string;
  ownerPubkey: string;
  repoName: string;
  description?: string;
  relays?: string[];
  cloneUrls?: string[];
  webUrls?: string[];
  maintainers?: string[];
  hashtags?: string[];
  earliestUniqueCommit?: string;
  community?: RepoCommunityBinding;
  refs?: GraspRef[];
  head?: string;
}

export function createGraspAnnouncementAndState({
  relayUrl,
  ownerPubkey,
  repoName,
  description,
  relays = [],
  cloneUrls,
  webUrls,
  maintainers,
  hashtags,
  earliestUniqueCommit,
  community,
  refs,
  head,
}: CreateGraspEventsParams): {
  ownerNpub: string;
  wsOrigin: string;
  httpOrigin: string;
  cloneUrl: string;
  webUrl: string;
  relays: string[];
  announcementEvent: RepoAnnouncementEvent;
  stateEvent: RepoStateEvent;
} {
  const { wsOrigin, httpOrigin } = normalizeGraspOrigins(relayUrl);
  const {
    ownerNpub,
    cloneUrls: defaultCloneUrls,
    webUrls: defaultWebUrls,
  } = buildGraspRepoUrls({
    relayUrls: [relayUrl],
    ownerPubkey,
    repoName,
  });
  const webUrl = defaultWebUrls[0] || `${httpOrigin}/${ownerNpub}/${repoName}`;
  const cloneUrl = defaultCloneUrls[0] || `${webUrl}.git`;

  const normalizedRelays = sanitizeRelays(relays);
  const finalCloneUrls = cloneUrls && cloneUrls.length > 0 ? cloneUrls : [cloneUrl];
  const finalWebUrls = webUrls && webUrls.length > 0 ? webUrls : [webUrl];

  const announcementEvent = createRepoAnnouncementEvent({
    repoId: `${ownerNpub}:${repoName}`,
    name: repoName,
    description: description || "",
    clone: finalCloneUrls,
    web: finalWebUrls,
    relays: normalizedRelays,
    maintainers,
    hashtags,
    earliestUniqueCommit,
    community,
  });

  const stateEvent = createRepoStateEvent({
    repoId: repoName,
    refs,
    head,
  });

  return {
    ownerNpub,
    wsOrigin,
    httpOrigin,
    cloneUrl,
    webUrl,
    relays: normalizedRelays,
    announcementEvent,
    stateEvent,
  };
}

export async function publishGraspRepoEvents(
  onPublishEvent:
    | ((event: RepoAnnouncementEvent | RepoStateEvent) => Promise<unknown> | unknown)
    | undefined,
  announcementEvent: RepoAnnouncementEvent,
  stateEvent: RepoStateEvent,
  onStage?: (stage: "announcement" | "state") => void
): Promise<GraspPublishRelayAck> {
  if (!onPublishEvent) {
    throw new Error("GRASP operation requires onPublishEvent callback");
  }

  onStage?.("announcement");
  const announcementResult = await onPublishEvent(announcementEvent);
  onStage?.("state");
  const stateResult = await onPublishEvent(stateEvent);

  const announcementAck = extractPublishRelayAck(announcementResult);
  const stateAck = extractPublishRelayAck(stateResult);

  const ackedRelays = intersectRelays(announcementAck.ackedRelays, stateAck.ackedRelays);
  const failedRelays = Array.from(
    new Set([
      ...announcementAck.failedRelays,
      ...stateAck.failedRelays,
      ...announcementAck.ackedRelays.filter((relay) => !ackedRelays.includes(relay)),
      ...stateAck.ackedRelays.filter((relay) => !ackedRelays.includes(relay)),
    ])
  );

  return {
    ackedRelays,
    failedRelays,
    successCount: ackedRelays.length,
    hasRelayOutcomes:
      announcementAck.hasRelayOutcomes || stateAck.hasRelayOutcomes || failedRelays.length > 0,
  };
}

export async function publishGraspRepoStateAndWait(
  params: PublishGraspRepoStateAndWaitParams
): Promise<GraspPublishRelayAck> {
  const published = await publishGraspEventWithRetry({
    relayUrl: params.relayUrl,
    event: params.stateEvent,
    onPublishEvent: params.onPublishEvent,
    publishRelays: params.publishRelays || [normalizeRelayOrigin(params.relayUrl)],
    maxAttempts: params.maxAttempts,
    retryDelayMs: params.retryDelayMs,
  });

  return published.relayAck;
}

export async function publishGraspRepoStateForPush({
  remoteUrl,
  branch,
  commitSha,
  authorPubkey,
  fallbackRepoName = "",
  onPublishEvent,
  publishRelays,
  maxAttempts,
  retryDelayMs,
  fetchRelayEvents,
}: PublishGraspRepoStateForPushParams): Promise<{
  relayUrl: string;
  repoName: string;
  event: NostrEvent;
  publishRelays: string[];
}> {
  if (!authorPubkey.trim()) {
    throw new Error("Existing GRASP state lookup requires the repository owner pubkey");
  }
  const { relayUrl, repoName } = parseGraspPushTarget(remoteUrl, fallbackRepoName);
  let existingStateEvent: NostrEvent | undefined;

  try {
    existingStateEvent = await fetchLatestGraspRepoStateEvent({
      relayUrl,
      repoName,
      fetchRelayEvents,
      authorPubkey,
    });
  } catch (error) {
    throw new Error(`Failed to fetch existing GRASP state before push: ${errorMessage(error)}`);
  }
  if (!existingStateEvent) {
    throw new Error(
      "Existing GRASP repository state is unavailable; refusing incomplete push state"
    );
  }

  const refs = mergeGraspRefs(getGraspStateRefsFromEvent(existingStateEvent), [
    { type: "heads", name: branch, commit: commitSha },
  ]);
  const head = resolveGraspStateHead({
    existingHead: getGraspStateHeadFromEvent(existingStateEvent),
    refs,
    fallbackHead: branch,
  });

  const stateEvent = createRepoStateEvent({
    repoId: repoName,
    head,
    refs,
    created_at: Math.max(Math.floor(Date.now() / 1000), existingStateEvent.created_at + 1),
  });

  const targetPublishRelays = publishRelays || [relayUrl];
  const published = await publishGraspEventWithRetry({
    relayUrl,
    event: stateEvent,
    onPublishEvent,
    publishRelays: targetPublishRelays,
    maxAttempts,
    retryDelayMs,
  });

  return { relayUrl, repoName, event: published.event, publishRelays: targetPublishRelays };
}

export async function waitForGraspProvisioning(params: {
  relayUrl: string;
  userPubkey: string;
  owner: string;
  repoName: string;
  maxAttempts?: number;
  delayMs?: number;
  onAttempt?: (info: {
    attempt: number;
    maxAttempts: number;
    repoExists: boolean;
    receivePackReady: boolean;
  }) => void;
}): Promise<void> {
  const {
    relayUrl,
    userPubkey,
    owner,
    repoName,
    maxAttempts = 15,
    delayMs = 3000,
    onAttempt,
  } = params;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let repoExists = false;
    let receivePackReady = false;

    try {
      const [probeResult, receivePackResult] = await Promise.allSettled([
        checkGraspRepoExists({
          relayUrl,
          userPubkey,
          owner,
          repoName,
        }),
        checkGraspReceivePackReady({
          relayUrl,
          owner,
          repoName,
        }),
      ]);

      repoExists =
        probeResult.status === "fulfilled" && probeResult.value
          ? Boolean(probeResult.value.exists)
          : false;
      receivePackReady =
        receivePackResult.status === "fulfilled" ? Boolean(receivePackResult.value) : false;

      if (probeResult.status === "rejected") {
        console.warn(
          "[GRASP] Provisioning check (upload-pack) attempt failed:",
          probeResult.reason
        );
      }

      if (receivePackResult.status === "rejected") {
        console.warn(
          "[GRASP] Provisioning check (receive-pack) attempt failed:",
          receivePackResult.reason
        );
      }
    } catch (unexpectedError) {
      console.warn("[GRASP] Provisioning check attempt failed unexpectedly:", unexpectedError);
    }

    onAttempt?.({
      attempt,
      maxAttempts,
      repoExists,
      receivePackReady,
    });

    if (receivePackReady) {
      return;
    }

    if (attempt < maxAttempts) {
      await delay(delayMs);
    }
  }

  throw new Error("GRASP relay did not provision read/write git endpoints in time");
}
