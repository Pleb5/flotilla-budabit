import type { RepoStateEvent } from "@nostr-git/core/events";

export interface RepoStateSnapshotRef {
  name: string;
  type: "heads" | "tags";
  fullRef: string;
  commitId: string;
}

export function getRepoStateEventsSignature(
  events?: Array<Pick<RepoStateEvent, "id" | "created_at" | "pubkey">>
): string {
  return (events || [])
    .map((event) => `${event.id}:${event.created_at}:${event.pubkey}`)
    .sort()
    .join("|");
}

export function getRepoStateSnapshotSignature(refs: RepoStateSnapshotRef[]): string {
  return refs
    .map((ref) => `${ref.type}:${ref.name}:${ref.commitId}:${ref.fullRef}`)
    .sort()
    .join("|");
}

export function disposeSubscriptions(unsubscribers: Array<() => void>): void {
  for (const unsubscribe of [...unsubscribers].reverse()) {
    try {
      unsubscribe();
    } catch {
      // pass
    }
  }
}
