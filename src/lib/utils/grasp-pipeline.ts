import {
  createRepoAnnouncementEvent,
  createRepoStateEvent,
  type RepoAnnouncementEvent,
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
}

export interface FetchRelayEventsParams {
  relays: string[];
  filters: NostrFilter[];
  timeoutMs?: number;
}

export type FetchRelayEvents = (params: FetchRelayEventsParams) => Promise<NostrEvent[]>;

export interface WaitForGraspRepoStateVisibilityParams {
  relayUrl: string;
  stateEvent: RepoStateEvent;
  fetchRelayEvents?: FetchRelayEvents;
  authorPubkey?: string;
  visibilityTimeoutMs?: number;
  pollIntervalMs?: number;
  settleDelayMs?: number;
}

export interface PublishGraspRepoStateAndWaitParams {
  relayUrl: string;
  stateEvent: RepoStateEvent;
  onPublishEvent: (event: RepoStateEvent) => Promise<unknown> | unknown;
  fetchRelayEvents?: FetchRelayEvents;
  authorPubkey?: string;
  visibilityTimeoutMs?: number;
  pollIntervalMs?: number;
  settleDelayMs?: number;
}

export interface PublishGraspRepoStateForPushParams {
  remoteUrl: string;
  branch: string;
  commitSha: string;
  fallbackRepoName?: string;
  onPublishEvent: (event: RepoStateEvent) => Promise<unknown> | unknown;
  fetchRelayEvents?: FetchRelayEvents;
  authorPubkey?: string;
  visibilityTimeoutMs?: number;
  pollIntervalMs?: number;
  settleDelayMs?: number;
}

export interface GraspStateVisibilityResult {
  visible: boolean;
  reason?: string;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeRelayForCompare(relay: string): string {
  const trimmed = String(relay || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`.replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

export function extractPublishRelayAck(result: unknown): GraspPublishRelayAck {
  const ackedRelays = new Set<string>();
  const failedRelays = new Set<string>();

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
  }

  for (const relay of ackedRelays) {
    failedRelays.delete(relay);
  }

  return {
    ackedRelays: Array.from(ackedRelays),
    failedRelays: Array.from(failedRelays),
    successCount: ackedRelays.size,
    hasRelayOutcomes: ackedRelays.size + failedRelays.size > 0,
  };
}

function intersectRelays(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((relay) => setB.has(relay));
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

function getRepoNameFromStateEvent(stateEvent: RepoStateEvent): string {
  const repoTag = stateEvent.tags.find((tag) => tag[0] === "d");
  const repoName = String(repoTag?.[1] || "").trim();
  if (!repoName) {
    throw new Error("Repo state event is missing required d tag");
  }
  return repoName;
}

function getExpectedStateRefTags(stateEvent: RepoStateEvent): string[][] {
  return stateEvent.tags.filter((tag) => String(tag[0] || "").startsWith("refs/"));
}

function hasMatchingRepoStateEvent(
  event: NostrEvent | RepoStateEvent | undefined,
  params: {
    stateEvent: RepoStateEvent;
    repoName: string;
    authorPubkey?: string;
  }
): boolean {
  if (!event || event.kind !== 30618) return false;
  if (params.authorPubkey && event.pubkey && event.pubkey !== params.authorPubkey) return false;

  const tags = Array.isArray(event.tags) ? event.tags : [];
  const hasRepoTag = tags.some(
    (tag) => Array.isArray(tag) && tag[0] === "d" && String(tag[1] || "") === params.repoName
  );

  if (!hasRepoTag) return false;

  const expectedRefs = getExpectedStateRefTags(params.stateEvent);
  const refsMatch = expectedRefs.every((expectedTag) =>
    tags.some(
      (tag) =>
        Array.isArray(tag) &&
        tag[0] === expectedTag[0] &&
        String(tag[1] || "") === String(expectedTag[1] || "")
    )
  );

  if (!refsMatch) return false;

  const expectedHead = params.stateEvent.tags.find((tag) => tag[0] === "HEAD");
  if (!expectedHead) return true;

  return tags.some(
    (tag) =>
      Array.isArray(tag) &&
      tag[0] === "HEAD" &&
      String(tag[1] || "") === String(expectedHead[1] || "")
  );
}

function buildRepoStateVisibilityFilters(params: {
  stateEvent: RepoStateEvent;
  repoName: string;
  authorPubkey?: string;
}): NostrFilter[] {
  const filter: NostrFilter = {
    kinds: [30618],
    "#d": [params.repoName],
    limit: 10,
  };

  if (params.authorPubkey) {
    filter.authors = [params.authorPubkey];
  }

  if (typeof params.stateEvent.created_at === "number") {
    filter.since = Math.max(0, params.stateEvent.created_at - 10);
  }

  return [filter];
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
  const repoName = repoSegment.replace(/\.git$/i, "");

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

export interface GraspRef {
  type: "heads" | "tags";
  name: string;
  commit: string;
}

export function normalizeGraspOrigins(input: string): { wsOrigin: string; httpOrigin: string } {
  try {
    const url = new URL(input);
    const host = url.host;
    const isSecure = url.protocol === "wss:" || url.protocol === "https:";
    return {
      wsOrigin: isSecure ? `wss://${host}` : `ws://${host}`,
      httpOrigin: isSecure ? `https://${host}` : `http://${host}`,
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
  const cloneUrls: string[] = [];
  const webUrls: string[] = [];
  const seenCloneUrls = new Set<string>();
  const seenWebUrls = new Set<string>();

  for (const relayUrl of relayUrls) {
    const trimmed = String(relayUrl || "").trim();
    if (!trimmed) continue;

    const { httpOrigin } = normalizeGraspOrigins(trimmed);
    const webUrl = `${httpOrigin}/${ownerNpub}/${repoName}`;
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
  });

  const stateEvent = createRepoStateEvent({
    repoId: repoName,
    refs,
    head,
  });

  if (normalizedRelays.length > 0 && !(stateEvent.tags as any[])?.some((t) => t[0] === "relays")) {
    stateEvent.tags = [...(stateEvent.tags || []), ["relays", ...normalizedRelays] as any];
  }

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

export async function waitForGraspRepoStateVisibility({
  relayUrl,
  stateEvent,
  fetchRelayEvents,
  authorPubkey,
  visibilityTimeoutMs = 3000,
  pollIntervalMs = 500,
  settleDelayMs = 800,
}: WaitForGraspRepoStateVisibilityParams): Promise<GraspStateVisibilityResult> {
  if (!fetchRelayEvents) {
    if (settleDelayMs > 0) {
      await delay(settleDelayMs);
    }
    return { visible: true };
  }

  const normalizedRelayUrl = normalizeRelayOrigin(relayUrl);
  const repoName = getRepoNameFromStateEvent(stateEvent);
  const filters = buildRepoStateVisibilityFilters({ stateEvent, repoName, authorPubkey });
  const deadline = Date.now() + Math.max(0, visibilityTimeoutMs);
  let lastError = "";
  let successfulQueryCount = 0;

  while (true) {
    try {
      const remainingMs = Math.max(0, deadline - Date.now());
      const events = await fetchRelayEvents({
        relays: [normalizedRelayUrl],
        filters,
        ...(visibilityTimeoutMs > 0
          ? { timeoutMs: Math.max(1, Math.min(2500, remainingMs > 0 ? remainingMs : 1)) }
          : {}),
      });
      successfulQueryCount += 1;

      const visible = events.some((event) =>
        hasMatchingRepoStateEvent(event, { stateEvent, repoName, authorPubkey })
      );

      if (visible) {
        if (settleDelayMs > 0) {
          await delay(settleDelayMs);
        }
        return { visible: true };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error || "unknown error");
    }

    if (Date.now() >= deadline) {
      break;
    }

    if (pollIntervalMs > 0) {
      await delay(pollIntervalMs);
    }
  }

  const expectedRefs = getExpectedStateRefTags(stateEvent)
    .map((tag) => `${tag[0]}@${String(tag[1] || "").slice(0, 8)}`)
    .join(", ");
  const reasonPrefix =
    successfulQueryCount > 0
      ? `Repo state for ${repoName}${expectedRefs ? ` (${expectedRefs})` : ""} was not visible on ${normalizedRelayUrl} within the verification window before push`
      : `Repo state for ${repoName}${expectedRefs ? ` (${expectedRefs})` : ""} could not be queried on ${normalizedRelayUrl} before push`;
  const suffix =
    lastError && successfulQueryCount > 0
      ? ` (last query error: ${lastError})`
      : lastError
        ? ` (${lastError})`
        : "";
  const reason = `${reasonPrefix}${suffix}`;

  console.warn(`[GRASP] ${reason}. Continuing without strict state verification.`);

  return {
    visible: false,
    reason,
  };
}

export async function publishGraspRepoStateAndWait({
  relayUrl,
  stateEvent,
  onPublishEvent,
  fetchRelayEvents,
  authorPubkey,
  visibilityTimeoutMs,
  pollIntervalMs,
  settleDelayMs,
}: PublishGraspRepoStateAndWaitParams): Promise<GraspPublishRelayAck> {
  const publishResult = await onPublishEvent(stateEvent);
  const relayAck = extractPublishRelayAck(publishResult);

  if (relayAck.hasRelayOutcomes && !didRelayAckGraspEvents(relayAck, relayUrl)) {
    const repoName = getRepoNameFromStateEvent(stateEvent);
    throw new Error(`Selected GRASP relay did not ACK repo state for ${repoName}; skipping push`);
  }

  await waitForGraspRepoStateVisibility({
    relayUrl,
    stateEvent,
    fetchRelayEvents,
    authorPubkey,
    visibilityTimeoutMs,
    pollIntervalMs,
    settleDelayMs,
  });

  return relayAck;
}

export async function publishGraspRepoStateForPush({
  remoteUrl,
  branch,
  commitSha,
  fallbackRepoName = "",
  onPublishEvent,
  fetchRelayEvents,
  authorPubkey,
  visibilityTimeoutMs,
  pollIntervalMs,
  settleDelayMs,
}: PublishGraspRepoStateForPushParams): Promise<{ relayUrl: string; repoName: string }> {
  const { relayUrl, repoName } = parseGraspPushTarget(remoteUrl, fallbackRepoName);
  const stateEvent = createRepoStateEvent({
    repoId: repoName,
    head: branch,
    refs: [{ type: "heads", name: branch, commit: commitSha }],
  });

  await publishGraspRepoStateAndWait({
    relayUrl,
    stateEvent,
    onPublishEvent,
    fetchRelayEvents,
    authorPubkey,
    visibilityTimeoutMs,
    pollIntervalMs,
    settleDelayMs,
  });

  return { relayUrl, repoName };
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

    if (repoExists || receivePackReady) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("GRASP relay did not provision read/write git endpoints in time");
}
