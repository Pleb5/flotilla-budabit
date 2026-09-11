import type { NostrEvent, RepoStateEvent } from "@nostr-git/core";
import { RepoCore } from "@nostr-git/core/git";
import { sanitizeRelays } from "@nostr-git/core/utils";
import type { FetchRelayEvents } from "./grasp-pipeline.js";
import { metadataValues } from "./repo-creation-metadata.js";
import type {
  RepoCreationRecoveryRecord,
  RepoCreationTargetRecord,
} from "./repo-creation-transaction.js";

export class RepoRecoveryStateConflict extends Error {
  constructor(
    message: string,
    public stateEvent?: NostrEvent
  ) {
    super(
      `${message} Completed work was retained. Resolve the current branch/tag state before retrying metadata recovery; recovery will not reset Git refs.`
    );
    this.name = "RepoRecoveryStateConflict";
  }
}

export class RepoRecoveryStateOrderingRequired extends RepoRecoveryStateConflict {
  constructor(event: NostrEvent) {
    super("Repository state advanced during preparation.", event);
    this.name = "RepoRecoveryStateOrderingRequired";
    this.message =
      "Repository state advanced while preparing delivery. Retry recovery to prepare a newer state event. Completed work was retained.";
  }
}

type AdvertisedRef = {
  ref?: string;
  oid?: string;
  target?: string;
  symref?: string;
  value?: string;
};
const stateContents = (event: NostrEvent) =>
  JSON.stringify([event.content, event.tags.map((tag) => JSON.stringify(tag)).sort()]);

export const sameRecoveryStateContents = (left: NostrEvent, right: NostrEvent): boolean =>
  stateContents(left) === stateContents(right);

const sameSignedEvent = (left: NostrEvent, right: NostrEvent): boolean =>
  Boolean(left.id && left.sig) &&
  left.id === right.id &&
  left.sig === right.sig &&
  left.kind === right.kind &&
  left.pubkey === right.pubkey &&
  left.created_at === right.created_at &&
  left.content === right.content &&
  JSON.stringify(left.tags) === JSON.stringify(right.tags);

/** A selected destination in our provisional announcement is not established
 * hosting. An original source or an independent owner announcement is authority. */
function existingCloneUrls(record: RepoCreationRecoveryRecord, announcement: NostrEvent): string[] {
  if (
    record.sourceMetadata?.announcementEvent?.id === announcement.id ||
    !record.publishedEvents.some((item) => sameSignedEvent(item.event, announcement))
  )
    return metadataValues(announcement, "clone");
  return record.sourceMetadata?.cloneUrls || [];
}

/** Only exact provisional receipts with compatible, lossless subset contents are
 * unfinished progress. A final attempt, altered receipt, changed commit/HEAD or
 * extra metadata is never covered by this exception. Live refs are still checked. */
function isProvisionalProgress(
  record: RepoCreationRecoveryRecord,
  event: NostrEvent,
  state: NostrEvent
): boolean {
  const receipt = record.publishedEvents.find((item) => sameSignedEvent(item.event, event));
  if (
    receipt?.stage !== "provisional" ||
    event.content !== state.content ||
    record.publishedEvents.some((item) => item.event.id === event.id && item.stage === "final")
  )
    return false;
  const tags = new Set(state.tags.map((tag) => JSON.stringify(tag)));
  const refs = event.tags.filter((tag) => /^refs\/(heads|tags)\//.test(tag[0]));
  return (
    refs.length > 0 &&
    new Set(refs.map((tag) => tag[0])).size === refs.length &&
    event.tags.filter((tag) => tag[0] === "HEAD").length === 1 &&
    event.tags.every((tag) => tags.has(JSON.stringify(tag)))
  );
}

export interface RecoveryStateEvidence {
  /** Latest state actually observed on a relay (or retained from an earlier read). */
  observed?: NostrEvent;
  /** Also includes checkpointed timestamps, even if a relay omits an old receipt. */
  newest?: NostrEvent;
}

/** A verified push receipt is historical evidence, not permission to advertise its
 * old commits with a new timestamp. This guard is for unsigned state only; exact
 * signed delivery has its own path and must never be "refreshed" by re-signing. */
export async function assertRecoveryStateCurrent(params: {
  record: RepoCreationRecoveryRecord;
  announcement: NostrEvent;
  state: RepoStateEvent;
  targets: RepoCreationTargetRecord[];
  fetchEvents: FetchRelayEvents;
  listServerRefs: (params: { url: string; symrefs: boolean }) => Promise<AdvertisedRef[]>;
  requireNewerTimestamp?: boolean;
}): Promise<RecoveryStateEvidence> {
  const { record, announcement, state, targets, fetchEvents, listServerRefs } = params;
  if (state.id && state.sig) return {};
  const context = { repoEvent: announcement };
  const authors = RepoCore.trustedMaintainers(context).filter((author) =>
    /^[0-9a-f]{64}$/.test(author)
  );
  const relays = sanitizeRelays([
    ...(record.repositoryRelayUrls || []),
    ...metadataValues(announcement, "relays"),
    ...record.targets.flatMap((target) => (target.relayUrl ? [target.relayUrl] : [])),
  ]);
  if (!relays.length)
    throw new RepoRecoveryStateConflict(
      "Cannot verify current repository state without relay destinations."
    );
  const events: NostrEvent[] = record.stateConflictEvent ? [record.stateConflictEvent] : [];
  const latestState = (candidates = events) =>
    RepoCore.selectAuthorizedRepoStateEvent(
      context,
      candidates.filter(
        (event) =>
          event.kind === 30618 &&
          event.tags.some((tag) => tag[0] === "d" && tag[1] === record.repoName)
      ) as RepoStateEvent[]
    );
  // Remove only compatible provisional progress before choosing independent
  // authority, so a newer own receipt cannot mask an intervening owner edit.
  const independentState = () =>
    latestState(events.filter((event) => !isProvisionalProgress(record, event, state)));
  try {
    for (const relay of relays)
      events.push(
        ...(await fetchEvents({
          relays: [relay],
          filters: [{ kinds: [30618], authors, "#d": [record.repoName] }],
          timeoutMs: 5000,
          throwOnTimeout: true,
        }))
      );
  } catch (error) {
    const observed = independentState() || latestState();
    throw new RepoRecoveryStateConflict(
      `Could not verify current repository state: ${error instanceof Error ? error.message : String(error)}.`,
      observed
    );
  }
  const current = independentState();
  // Comparing complete contents also protects HEAD, ancestry and extension tags
  // that the checkpoint-derived builder cannot reconstruct losslessly.
  if (current && stateContents(current) !== stateContents(state))
    throw new RepoRecoveryStateConflict(
      "Authoritative repository state differs from the saved setup checkpoint.",
      current
    );

  const proposedRefs = new Map(
    [...RepoCore.getRepoStateRefs(state).values()].map((ref) => [ref.fullRef, ref.commitId])
  );
  const proposedHead = state.tags.find((tag) => tag[0] === "HEAD")?.[1];
  const observed = latestState();
  // Existing hosting is part of this coordinate too, not upstream provenance.
  // A push there may advance without a relay state event or a push to our target.
  const sources = [...new Set(existingCloneUrls(record, announcement))]
    .filter((url) => !targets.some((target) => target.remoteUrl === url))
    .map((remoteUrl) => ({
      remoteUrl,
      label: remoteUrl,
      refs: [...proposedRefs].map(([ref, commit]) => ({ ref, commit })),
    }));
  for (const target of [...targets, ...sources]) {
    if (!target.remoteUrl)
      throw new RepoRecoveryStateConflict(
        `Current Git refs are unavailable for ${target.label}.`,
        observed
      );
    let advertised: AdvertisedRef[];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      advertised = await Promise.race([
        listServerRefs({ url: target.remoteUrl, symrefs: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Git-ref read timed out")), 10000);
        }),
      ]);
      if (!Array.isArray(advertised)) throw new Error("Git-ref read returned no result");
    } catch (error) {
      throw new RepoRecoveryStateConflict(
        `Could not verify current Git refs for ${target.label}: ${error instanceof Error ? error.message : String(error)}.`,
        observed
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
    const live = new Map(advertised.map((ref) => [ref.ref, ref.oid]));
    const checkpoint = new Map(
      target.refs
        .filter((ref) => ref.commit && /^refs\/(heads|tags)\//.test(ref.ref))
        .map((ref) => [ref.ref, ref.commit])
    );
    const liveNames = advertised
      .map((ref) => ref.ref || "")
      .filter((ref) => /^refs\/(heads|tags)\//.test(ref) && !ref.endsWith("^{}"));
    if (
      !checkpoint.size ||
      liveNames.some((ref) => !checkpoint.has(ref)) ||
      [...checkpoint].some(
        ([ref, commit]) =>
          proposedRefs.get(ref) !== commit ||
          (live.get(ref) !== commit &&
            (!ref.startsWith("refs/tags/") || live.get(`${ref}^{}`) !== commit))
      )
    )
      throw new RepoRecoveryStateConflict(
        `Git refs changed since the saved setup checkpoint on ${target.label}.`,
        observed
      );
    const head = advertised.find((ref) => ref.ref === "HEAD");
    const headTarget = (head?.target || head?.symref || head?.value || "").replace(/^ref: /, "");
    if (!headTarget || `ref: ${headTarget}` !== proposedHead)
      throw new RepoRecoveryStateConflict(
        `Current Git HEAD is changed or could not be verified on ${target.label}.`,
        observed
      );
  }
  const evidence = {
    observed,
    newest: latestState([...events, ...record.publishedEvents.map((item) => item.event)]),
  };
  if (
    params.requireNewerTimestamp &&
    evidence.newest &&
    state.created_at <= evidence.newest.created_at
  )
    throw new RepoRecoveryStateOrderingRequired(evidence.newest);
  return evidence;
}
