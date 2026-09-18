import type { NostrEvent } from "@nostr-git/core";
import { parsePublicRepoUrl, type PublicRepoSource } from "@nostr-git/core/git";
import { sanitizeRelays } from "@nostr-git/core/utils";
import type { FetchRelayEvents } from "./grasp-pipeline.js";
import type { RepoRelayCheckReport } from "./repo-creation-preflight.js";

export interface ExistingSourceAnnouncement {
  identifier: string;
  name: string;
}

/** A relay is fully checked only when none of the required reads there failed. */
export function mergeRepoRelayChecks(
  reports: Array<RepoRelayCheckReport | null>
): RepoRelayCheckReport {
  const checked = new Set<string>();
  const failures = new Map<string, Set<string>>();
  for (const report of reports) {
    report?.checkedRelays.forEach((relay) => checked.add(relay));
    for (const { relay, error } of report?.failedRelays || []) {
      if (!failures.has(relay)) failures.set(relay, new Set());
      failures.get(relay)!.add(error);
    }
  }
  return {
    checkedRelays: [...checked].filter((relay) => !failures.has(relay)),
    failedRelays: [...failures].map(([relay, errors]) => ({
      relay,
      error: [...errors].join("; "),
    })),
  };
}

/** Use only the latest owner-authored announcement for each opaque identifier. */
export function latestOwnerAnnouncements(owner: string, events: NostrEvent[]): NostrEvent[] {
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    const identifier = event.tags.find((tag) => tag[0] === "d")?.[1];
    if (event.kind !== 30617 || event.pubkey !== owner || !identifier) continue;
    const previous = latest.get(identifier);
    if (
      !previous ||
      event.created_at > previous.created_at ||
      (event.created_at === previous.created_at && event.id < previous.id)
    )
      latest.set(identifier, event);
  }
  return [...latest.values()];
}

export function findSourceAnnouncements(
  source: PublicRepoSource,
  owner: string,
  events: NostrEvent[]
): ExistingSourceAnnouncement[] {
  const key = (url: string) => {
    try {
      const parsed = parsePublicRepoUrl(url, source.provider);
      return source.provider === "github" ? parsed.url.toLowerCase() : parsed.url;
    } catch {
      return undefined;
    }
  };
  const sourceKey = key(source.cloneUrl);
  return latestOwnerAnnouncements(owner, events)
    .filter(
      (event) =>
        sourceKey &&
        event.tags
          .filter((tag) => tag[0] === "clone")
          .some((tag) => tag.slice(1).some((url) => key(url) === sourceKey))
    )
    .map((event) => ({
      identifier: event.tags.find((tag) => tag[0] === "d")![1],
      name:
        event.tags.find((tag) => tag[0] === "name")?.[1] ||
        event.tags.find((tag) => tag[0] === "d")![1],
    }));
}

/** Bounded, paginated owner inventory with explicit per-relay coverage. */
export async function loadOwnerRepoAnnouncements(params: {
  owner: string;
  relays: string[];
  knownEvents?: NostrEvent[];
  fetchEvents?: FetchRelayEvents;
  signal?: AbortSignal;
  assertActor?: () => void;
}): Promise<RepoRelayCheckReport & { events: NostrEvent[] }> {
  const relays = sanitizeRelays(params.relays);
  if (!params.owner || !params.fetchEvents || !relays.length)
    throw new Error("Select a repository relay to check your existing announcements");
  const inventory = [...(params.knownEvents || [])];
  const outcomes = await Promise.all(
    relays.map(async (relay) => {
      try {
        let until: number | undefined;
        const limit = 200;
        for (let page = 0; page < 20; page++) {
          params.signal?.throwIfAborted();
          params.assertActor?.();
          const events = await params.fetchEvents!({
            relays: [relay],
            filters: [
              {
                kinds: [30617],
                authors: [params.owner],
                limit,
                ...(until === undefined ? {} : { until }),
              },
            ],
            timeoutMs: 5000,
            throwOnTimeout: true,
            requireComplete: true,
            signal: params.signal,
            onEvent: (event) => inventory.push(event),
          });
          params.signal?.throwIfAborted();
          params.assertActor?.();
          inventory.push(...events);
          if (events.length < limit) return { relay, checked: true as const };
          const oldest = Math.min(...events.map((event) => event.created_at));
          // Inclusive pagination prevents dropping announcements sharing a timestamp.
          if (!Number.isFinite(oldest) || (until !== undefined && oldest >= until)) break;
          until = oldest;
        }
        throw new Error(
          "The repository announcement list could not be fully checked within the read limit."
        );
      } catch (cause) {
        params.signal?.throwIfAborted();
        params.assertActor?.();
        return {
          relay,
          checked: false as const,
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
    })
  );
  params.signal?.throwIfAborted();
  params.assertActor?.();
  return {
    events: latestOwnerAnnouncements(params.owner, inventory),
    checkedRelays: outcomes.filter((outcome) => outcome.checked).map((outcome) => outcome.relay),
    failedRelays: outcomes
      .filter((outcome) => !outcome.checked)
      .map((outcome) => ({ relay: outcome.relay, error: outcome.error! })),
  };
}
