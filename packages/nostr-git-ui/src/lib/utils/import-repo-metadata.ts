import {
  convertRepoToNostrEvent,
  convertRepoToStateEvent,
  type RepoMetadata,
  type NostrEvent,
} from "@nostr-git/core";
import { withRepoCommunityBinding, type RepoCommunityBinding } from "@nostr-git/core/events";
import { isGraspRepoHttpUrl } from "@nostr-git/core/utils";

import { normalizeGraspOrigins } from "./grasp-pipeline.js";

export function trackLatestRepoMetadataCreatedAt(
  current: number,
  ...events: Array<{ created_at?: number } | null | undefined>
): number {
  let latest = Number.isFinite(current) ? current : 0;

  for (const event of events) {
    const createdAt = Number(event?.created_at || 0);
    if (createdAt > latest) {
      latest = createdAt;
    }
  }

  return latest;
}

export function getFinalRepoMetadataCreatedAt(
  importTimestamp: number,
  latestProvisionalCreatedAt = 0
): number {
  const baseTimestamp = Number.isFinite(importTimestamp) ? importTimestamp : 0;
  const latestTimestamp = Number.isFinite(latestProvisionalCreatedAt)
    ? latestProvisionalCreatedAt
    : 0;

  return latestTimestamp >= baseTimestamp ? latestTimestamp + 1 : baseTimestamp;
}

export interface ImportedRemotePushResultLike {
  success: boolean;
  remoteUrl?: string;
  webUrl?: string;
}

export interface ImportedBranchRefLike {
  name: string;
  commit?: string;
}

export function getImportedRepoName(
  repo: Pick<RepoMetadata, "name" | "fullName">,
  destinationRepoName?: string
): string {
  const explicitName = destinationRepoName?.trim();
  if (explicitName) return explicitName;

  return repo.fullName.split("/").pop() || repo.name;
}

export function buildImportedRepoMetadata(
  repo: RepoMetadata,
  destinationRepoName?: string
): RepoMetadata {
  const repoName = getImportedRepoName(repo, destinationRepoName);
  if (repoName === repo.name && repo.fullName.split("/").pop() === repoName) {
    return repo;
  }

  const ownerPrefix = repo.fullName.includes("/")
    ? repo.fullName.split("/").slice(0, -1).join("/")
    : repo.owner?.login || "imported";

  return {
    ...repo,
    name: repoName,
    fullName: `${ownerPrefix}/${repoName}`,
  };
}

export function buildImportedRepoEvents(params: {
  repo: RepoMetadata;
  relays: string[];
  userPubkey: string;
  repoName?: string;
  importTimestamp: number;
  latestRepoMetadataCreatedAt?: number;
  remotePushResults?: ImportedRemotePushResultLike[];
  selectedBranchRefs?: ImportedBranchRefLike[];
  community?: RepoCommunityBinding;
}): {
  announcement: Omit<NostrEvent, "id" | "sig" | "pubkey">;
  state: Omit<NostrEvent, "id" | "sig" | "pubkey">;
} {
  const {
    repo,
    relays,
    userPubkey,
    repoName,
    importTimestamp,
    latestRepoMetadataCreatedAt = 0,
    remotePushResults = [],
    selectedBranchRefs = [],
    community,
  } = params;

  const repoForAnnouncement = buildImportedRepoMetadata(repo, repoName);

  const finalRepoMetadataCreatedAt = getFinalRepoMetadataCreatedAt(
    importTimestamp,
    latestRepoMetadataCreatedAt
  );

  let announcement = convertRepoToNostrEvent(
    repoForAnnouncement,
    relays,
    userPubkey,
    finalRepoMetadataCreatedAt
  );

  if (community) announcement = withRepoCommunityBinding(announcement, community);

  const successfulRemoteUrls = Array.from(
    new Set(
      remotePushResults
        .filter((result) => result.success)
        .map((result) => result.remoteUrl)
        .filter((value): value is string => Boolean(value))
    )
  );

  const successfulWebUrls = Array.from(
    new Set(
      remotePushResults
        .filter((result) => result.success)
        .map((result) => result.webUrl)
        .filter((value): value is string => Boolean(value))
    )
  );

  const successfulGraspRelays = Array.from(
    new Set(
      remotePushResults
        .filter(
          (result) => result.success && result.remoteUrl && isGraspRepoHttpUrl(result.remoteUrl)
        )
        .map((result) => normalizeGraspOrigins(result.remoteUrl as string).wsOrigin)
        .filter(Boolean)
    )
  );

  if (successfulRemoteUrls.length > 0) {
    announcement.tags = [
      ...announcement.tags.filter((tag) => tag[0] !== "clone"),
      ["clone", ...successfulRemoteUrls],
    ];
  }

  if (successfulWebUrls.length > 0) {
    announcement.tags = [
      ...announcement.tags.filter((tag) => tag[0] !== "web"),
      ["web", ...successfulWebUrls],
    ];
  }

  const state = convertRepoToStateEvent(
    repoForAnnouncement,
    finalRepoMetadataCreatedAt,
    selectedBranchRefs
      .filter((branchRef) => Boolean(branchRef.commit))
      .map((branchRef) => ({
        type: "heads" as const,
        name: branchRef.name,
        commit: branchRef.commit as string,
      }))
  );

  const finalRelays = Array.from(new Set([...(relays || []), ...successfulGraspRelays]));

  if (finalRelays.length > 0 && !state.tags.some((tag) => tag[0] === "relays")) {
    state.tags = [...state.tags, ["relays", ...finalRelays] as any];
  }

  return { announcement, state };
}
