import type { NostrEvent } from "@nostr-git/core";
import { getRepoStorageKeyCandidates } from "@nostr-git/core/git";
import { validateRepoIdentifier } from "@nostr-git/core/utils";

import type { DeleteRepoEvent, FetchRelayEvents, PublishRepoEvent } from "./grasp-pipeline.js";
import { normalizeRelayUrl, type RemoteTargetSelection } from "./remote-targets.js";
import type { RepoCreationRecoveryRecord } from "./repo-creation-transaction.js";

const activeCoordinates = new Set<string>();

/** Same-window duplicate protection, not a global reservation on Nostr relays. */
export function reserveRepoCreation(
  owner: string,
  identifier: string,
  pending: RepoCreationRecoveryRecord[] = []
): () => void {
  const coordinate = `30617:${owner}:${identifier}`;
  if (activeCoordinates.has(coordinate))
    throw new Error(`Repository creation is already in progress for identifier "${identifier}"`);
  if (
    pending.some(
      (record) =>
        record.ownerPubkey === owner &&
        record.repoName === identifier &&
        (record.phase !== "failed" ||
          record.manualAttention.required ||
          record.pendingCompensations.length > 0 ||
          !["planned", "cleaned"].includes(record.localResource.stage) ||
          record.publishedEvents.length > 0)
    )
  ) {
    throw new Error(
      `A recorded creation for identifier "${identifier}" needs recovery. Resume or resolve it before starting a new repository.`
    );
  }
  activeCoordinates.add(coordinate);
  return () => {
    activeCoordinates.delete(coordinate);
  };
}

export interface RepoCreationPrerequisites {
  ownerPubkey: string;
  repoName: string;
  targets: RemoteTargetSelection[];
  relayUrls: string[];
  onPublishEvent?: PublishRepoEvent;
  onFetchRelayEvents?: FetchRelayEvents;
  onDeleteEvent?: DeleteRepoEvent;
  hasRollbackCallback?: boolean;
  /** Existing accepted identifiers are opaque; do not revalidate them as new slugs. */
  existingCoordinate?: boolean;
}

export function assertRepoCreationPrerequisites(params: RepoCreationPrerequisites): string[] {
  const ownerPubkey = String(params.ownerPubkey || "").trim();
  const repoName = String(params.repoName || "").trim();
  const relayUrls = Array.from(new Set(params.relayUrls.map(normalizeRelayUrl).filter(Boolean)));

  if (!ownerPubkey) throw new Error("Repository creation requires an owner pubkey");
  if (!repoName) throw new Error("Repository creation requires a repository identifier");
  if (!params.existingCoordinate) {
    const error = validateRepoIdentifier(params.repoName);
    if (error) throw new Error(error);
  }
  if (params.targets.length === 0) throw new Error("Select at least one repository target");
  if (relayUrls.length === 0) throw new Error("Repository creation requires a metadata relay");
  if (!params.onPublishEvent) {
    throw new Error("Repository creation requires metadata publication with relay outcomes");
  }
  if (!params.onFetchRelayEvents) {
    throw new Error("Repository creation requires exact per-relay metadata reads");
  }
  if (!params.onDeleteEvent && !params.hasRollbackCallback) {
    throw new Error("Repository creation requires provisional metadata compensation");
  }

  return relayUrls;
}

export async function assertRepoCoordinateAvailable(params: {
  ownerPubkey: string;
  repoName: string;
  relayUrls: string[];
  onFetchRelayEvents: FetchRelayEvents;
  knownEvents?: Array<Pick<NostrEvent, "kind" | "pubkey" | "tags">>;
}): Promise<void> {
  assertRepoCoordinateNotKnown(params.ownerPubkey, params.repoName, params.knownEvents || []);
  const relayUrls = Array.from(new Set(params.relayUrls.map(normalizeRelayUrl).filter(Boolean)));
  if (!relayUrls.length)
    throw new Error("Could not verify repository coordinate availability without a relay");
  for (const relayUrl of relayUrls) {
    let events: NostrEvent[];
    try {
      events = await params.onFetchRelayEvents({
        relays: [relayUrl],
        filters: [
          { kinds: [30617, 30618], authors: [params.ownerPubkey], "#d": [params.repoName] },
        ],
        timeoutMs: 5000,
        throwOnTimeout: true,
      });
    } catch (error) {
      throw new Error(
        `Could not verify repository coordinate availability on ${relayUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const existing = events.some(
      (event) =>
        (event.kind === 30617 || event.kind === 30618) &&
        event.pubkey === params.ownerPubkey &&
        event.tags.some((tag) => tag[0] === "d" && tag[1] === params.repoName)
    );
    if (existing) {
      throw new Error(
        `You already have a repository with identifier "${params.repoName}" on ${relayUrl}. Open it, manage its hosting, resume its recorded creation, or choose another identifier.`
      );
    }
  }
}

/** Check both current and historical hosting representations, not the source clone's key. */
export async function assertLocalRepoCoordinateAvailable(
  owner: string,
  identifier: string,
  isRepoCloned: (params: { repoId: string }) => Promise<boolean>
): Promise<void> {
  for (const repoId of getRepoStorageKeyCandidates(owner, identifier)) {
    let exists: boolean;
    try {
      exists = await isRepoCloned({ repoId });
      if (typeof exists !== "boolean") throw new Error("Local repository check returned no result");
    } catch (error) {
      throw new Error(
        `Could not verify local repository availability: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (exists) {
      throw new Error(
        `A local repository already exists for identifier "${identifier}". Open it or resolve its recorded creation before making a new fork.`
      );
    }
  }
}

export function assertRepoCoordinateNotKnown(
  owner: string,
  identifier: string,
  events: Array<Pick<NostrEvent, "kind" | "pubkey" | "tags">>
): void {
  if (
    events.some(
      (event) =>
        [30617, 30618].includes(event.kind) &&
        event.pubkey === owner &&
        event.tags.some((tag) => tag[0] === "d" && tag[1] === identifier)
    )
  ) {
    throw new Error(
      `You already have a repository with identifier "${identifier}". Open it, manage its hosting, or choose another identifier.`
    );
  }
}

/** Hosting edits must not overwrite another owner-authored settings change discovered during sync. */
export async function assertRepoAnnouncementCurrent(
  source: NostrEvent,
  relayUrls: string[],
  fetchEvents: FetchRelayEvents,
  ownEventIds: string[] = []
): Promise<void> {
  const identifier = source.tags.find((tag) => tag[0] === "d")?.[1];
  if (source.kind !== 30617 || !identifier)
    throw new Error("An exact source announcement is required to add hosting");
  const known = new Set([source.id, ...ownEventIds]);
  for (const relay of Array.from(new Set(relayUrls.map(normalizeRelayUrl).filter(Boolean)))) {
    const events = await fetchEvents({
      relays: [relay],
      filters: [{ kinds: [30617], authors: [source.pubkey], "#d": [identifier] }],
      timeoutMs: 5000,
      throwOnTimeout: true,
    });
    if (
      events.some(
        (event) =>
          event.kind === 30617 &&
          event.pubkey === source.pubkey &&
          event.tags.find((tag) => tag[0] === "d")?.[1] === identifier &&
          !known.has(event.id) &&
          (event.created_at > source.created_at ||
            (event.created_at === source.created_at && event.id < source.id))
      )
    ) {
      throw new Error(
        "Repository settings changed during hosting setup. Reload the repository before adding hosting."
      );
    }
  }
}
