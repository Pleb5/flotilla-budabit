import type { NostrEvent } from "@nostr-git/core";

import type { DeleteRepoEvent, FetchRelayEvents, PublishRepoEvent } from "./grasp-pipeline.js";
import { normalizeRelayUrl, type RemoteTargetSelection } from "./remote-targets.js";

export interface RepoCreationPrerequisites {
  ownerPubkey: string;
  repoName: string;
  targets: RemoteTargetSelection[];
  relayUrls: string[];
  onPublishEvent?: PublishRepoEvent;
  onFetchRelayEvents?: FetchRelayEvents;
  onDeleteEvent?: DeleteRepoEvent;
  hasRollbackCallback?: boolean;
}

export function assertRepoCreationPrerequisites(params: RepoCreationPrerequisites): string[] {
  const ownerPubkey = String(params.ownerPubkey || "").trim();
  const repoName = String(params.repoName || "").trim();
  const relayUrls = Array.from(new Set(params.relayUrls.map(normalizeRelayUrl).filter(Boolean)));

  if (!ownerPubkey) throw new Error("Repository creation requires an owner pubkey");
  if (!repoName) throw new Error("Repository creation requires a repository name");
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
}): Promise<void> {
  for (const relayUrl of Array.from(
    new Set(params.relayUrls.map(normalizeRelayUrl).filter(Boolean))
  )) {
    let events: NostrEvent[];
    try {
      events = await params.onFetchRelayEvents({
        relays: [relayUrl],
        filters: [{ kinds: [30617], authors: [params.ownerPubkey], "#d": [params.repoName] }],
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
        event.kind === 30617 &&
        event.pubkey === params.ownerPubkey &&
        event.tags.some((tag) => tag[0] === "d" && tag[1] === params.repoName)
    );
    if (existing) {
      throw new Error(`Repository coordinate already exists on ${relayUrl}`);
    }
  }
}
