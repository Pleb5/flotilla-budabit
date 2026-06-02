// NIP-51: Git Collaboration Event Types for Nostr
// https://github.com/nostr-protocol/nips/blob/master/51.md

import { NostrEvent } from "nostr-tools";

export const GRASP_SET_KIND = 30002; // NIP-51 set kind per app convention
export const DEFAULT_GRASP_SET_ID = 'grasp-servers';

export const GIT_REPO_BOOKMARK_SET = 30003; // NIP-51 set kind per app convention

export const GIT_REPO_BOOKMARK_DTAG = "git-repo-bookmark";

export type GraspSetTag =
    | ["d", string]
    | ["relay", string]
    | ["author", string]

export interface GraspSetEvent extends NostrEvent {
    kind: typeof GRASP_SET_KIND
    tags: GraspSetTag[]
}

export function isGraspSetEvent(event: NostrEvent): event is GraspSetEvent {
    return event.kind === GRASP_SET_KIND;
}

export type GitRepoBookmarkSetTag =
    | ["d", string]
    | ["author", string]

export interface GitRepoBookmarkSetEvent extends NostrEvent {
    kind: typeof GIT_REPO_BOOKMARK_SET
    tags: GitRepoBookmarkSetTag[]
}

export function isGitRepoBookmarkSetEvent(event: NostrEvent): event is GitRepoBookmarkSetEvent {
    return event.kind === GIT_REPO_BOOKMARK_SET;
}