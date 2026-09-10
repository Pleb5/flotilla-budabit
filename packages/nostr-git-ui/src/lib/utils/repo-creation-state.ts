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

type AdvertisedRef = {
  ref?: string;
  oid?: string;
  target?: string;
  symref?: string;
  value?: string;
};
const stateContents = (event: NostrEvent) =>
  JSON.stringify([event.content, event.tags.map((tag) => JSON.stringify(tag)).sort()]);

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
}): Promise<void> {
  const { record, announcement, state, targets, fetchEvents, listServerRefs } = params;
  if (state.id && state.sig) return;
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
  const latestState = () =>
    RepoCore.selectAuthorizedRepoStateEvent(
      context,
      events.filter(
        (event) =>
          event.kind === 30618 &&
          event.tags.some((tag) => tag[0] === "d" && tag[1] === record.repoName)
      ) as RepoStateEvent[]
    );
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
    const observed = latestState();
    throw new RepoRecoveryStateConflict(
      `Could not verify current repository state: ${error instanceof Error ? error.message : String(error)}.`,
      observed && stateContents(observed) !== stateContents(state) ? observed : undefined
    );
  }
  const current = latestState();
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
  // Existing hosting is part of this coordinate too, not upstream provenance.
  // A push there may advance without a relay state event or a push to our target.
  const sources = [...new Set(metadataValues(announcement, "clone"))]
    .filter((url) => !targets.some((target) => target.remoteUrl === url))
    .map((remoteUrl) => ({
      remoteUrl,
      label: remoteUrl,
      refs: [...proposedRefs].map(([ref, commit]) => ({ ref, commit })),
    }));
  for (const target of [...targets, ...sources]) {
    if (!target.remoteUrl)
      throw new RepoRecoveryStateConflict(`Current Git refs are unavailable for ${target.label}.`);
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
        `Could not verify current Git refs for ${target.label}: ${error instanceof Error ? error.message : String(error)}.`
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
        `Git refs changed since the saved setup checkpoint on ${target.label}.`
      );
    const head = advertised.find((ref) => ref.ref === "HEAD");
    const headTarget = (head?.target || head?.symref || head?.value || "").replace(/^ref: /, "");
    if (!headTarget || `ref: ${headTarget}` !== proposedHead)
      throw new RepoRecoveryStateConflict(
        `Current Git HEAD is changed or could not be verified on ${target.label}.`
      );
  }
}
