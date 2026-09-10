import type { NostrEvent } from "@nostr-git/core";
import { sanitizeRelays } from "@nostr-git/core/utils";
import type { FetchRelayEvents } from "./grasp-pipeline.js";
import {
  assertRepoCreationEvent,
  type RepoCreationRecoveryRecord,
} from "./repo-creation-transaction.js";

export class RepoMetadataReviewRequired extends Error {
  constructor(
    message: string,
    public announcement?: NostrEvent
  ) {
    super(message);
    this.name = "RepoMetadataReviewRequired";
  }
}

export const metadataValues = (event: NostrEvent | undefined, name: string): string[] =>
  event?.tags.filter((tag) => tag[0] === name).flatMap((tag) => tag.slice(1)) || [];

/** Reads are exact-coordinate, finite, and fail closed. Our own delivery receipts
 * are not external edits and must not hide a newer independent owner edit. */
export async function readCurrentRecoveryAnnouncement(
  record: RepoCreationRecoveryRecord,
  base: NostrEvent,
  fetchEvents: FetchRelayEvents
): Promise<NostrEvent> {
  assertRepoCreationEvent(record, base, true);
  const relays = sanitizeRelays([
    ...(record.repositoryRelayUrls || []),
    ...metadataValues(base, "relays"),
    ...metadataValues(record.reviewAnnouncement, "relays"),
    ...record.targets.flatMap((target) => (target.relayUrl ? [target.relayUrl] : [])),
  ]);
  if (!relays.length)
    throw new RepoMetadataReviewRequired(
      "Cannot verify current repository metadata without relay destinations"
    );
  const ownIds = new Set(record.publishedEvents.map((item) => item.event.id));
  const candidates = [base];
  if (record.reviewAnnouncement) {
    assertRepoCreationEvent(record, record.reviewAnnouncement, true);
    candidates.push(record.reviewAnnouncement);
  }
  try {
    for (const relay of relays) {
      const events = await fetchEvents({
        relays: [relay],
        filters: [{ kinds: [30617], authors: [record.ownerPubkey], "#d": [record.repoName] }],
        timeoutMs: 5000,
        throwOnTimeout: true,
      });
      for (const event of events) {
        if (
          event.kind !== 30617 ||
          event.pubkey !== record.ownerPubkey ||
          event.tags.find((tag) => tag[0] === "d")?.[1] !== record.repoName ||
          ownIds.has(event.id)
        )
          continue;
        assertRepoCreationEvent(record, event, true);
        candidates.push(event);
      }
    }
  } catch (error) {
    throw new RepoMetadataReviewRequired(
      `Could not verify current repository metadata: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return candidates.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
}

export async function assertRecoveryAnnouncementCurrent(
  record: RepoCreationRecoveryRecord,
  expected: NostrEvent,
  fetchEvents: FetchRelayEvents
): Promise<void> {
  const current = await readCurrentRecoveryAnnouncement(record, expected, fetchEvents);
  if (current.id !== expected.id)
    throw new RepoMetadataReviewRequired(
      "Owner metadata changed. Review the current announcement before finishing hosting.",
      current
    );
}
