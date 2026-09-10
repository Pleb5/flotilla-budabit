import { describe, expect, it } from "vitest";
import { createGraspAnnouncementAndState } from "./grasp-pipeline.js";
import { publishRepoSyncAnnouncement } from "./remote-sync.js";
import { createRepoAnnouncementEvent, type RepoAnnouncementEvent } from "@nostr-git/core/events";
import { assertRepoAnnouncementCurrent } from "./repo-creation-preflight.js";

const owner = "a".repeat(64);
const upstream: ["u", string] = ["u", `30617:${"b".repeat(64)}:upstream`];

describe("repository metadata throughout publication", () => {
  it("keeps the display name and upstream on provisional metadata, using only d for hosting/state", async () => {
    const events = createGraspAnnouncementAndState({
      relayUrl: "wss://grasp.test",
      ownerPubkey: owner,
      repoName: "Fixed.Case",
      displayName: "名前 with spaces",
      upstreams: [upstream],
    });
    expect(events.announcementEvent.tags).toContainEqual(["d", "Fixed.Case"]);
    expect(events.announcementEvent.tags).toContainEqual(["name", "名前 with spaces"]);
    expect(events.announcementEvent.tags).toContainEqual(upstream);
    expect(events.stateEvent.tags).toContainEqual(["d", "Fixed.Case"]);
    expect(events.cloneUrl).toMatch(/\/Fixed\.Case\.git$/);

    const result = await publishRepoSyncAnnouncement({
      repoName: "Fixed.Case",
      displayName: "名前 with spaces",
      upstreams: [upstream],
      userPubkey: owner,
      targets: [],
      relayUrls: ["wss://metadata.test"],
      updateProgress: () => {},
      runAbortable: (operation) => operation(),
      onPublishEvent: (event, context) => ({
        event: { ...event, pubkey: owner, id: "fixture", sig: "fixture" },
        ackedRelays: context!.relays,
        hasRelayOutcomes: true,
      }),
    });
    expect(result.announcementEvent.tags).toContainEqual(["name", "名前 with spaces"]);
    expect(result.announcementEvent.tags).toContainEqual(["d", "Fixed.Case"]);
    expect(result.announcementEvent.tags).toContainEqual(upstream);
  });

  it("preserves unrelated metadata on same-coordinate provisional hosting announcements", async () => {
    const source: RepoAnnouncementEvent = {
      ...createRepoAnnouncementEvent({ repoId: "Fixed", name: "Keep name", upstreams: [upstream] }),
      pubkey: owner,
      id: "source",
      sig: "fixture",
      content: "Keep content",
    };
    source.tags.push(["maintainers", "c".repeat(64)], ["unknown", "value"]);
    const result = await publishRepoSyncAnnouncement({
      repoName: "Fixed",
      displayName: "Must not override existing metadata",
      userPubkey: owner,
      sourceAnnouncement: source,
      targets: [],
      relayUrls: ["wss://metadata.test"],
      updateProgress: () => {},
      runAbortable: (operation) => operation(),
      onPublishEvent: (event, context) => ({
        event: { ...event, pubkey: owner, id: "fixture", sig: "fixture" },
        ackedRelays: context!.relays,
        hasRelayOutcomes: true,
      }),
    });
    expect(result.announcementEvent.content).toBe("Keep content");
    for (const tag of source.tags) expect(result.announcementEvent.tags).toContainEqual(tag);
    expect(result.announcementEvent.created_at).toBeGreaterThan(source.created_at);
  });

  it("blocks stale hosting edits while accepting known in-flight events from the same transaction", async () => {
    const source = {
      ...createRepoAnnouncementEvent({ repoId: "Fixed", created_at: 100 }),
      pubkey: owner,
      id: "source",
      sig: "fixture",
    };
    const newer = { ...source, id: "newer", created_at: 101 };
    await expect(
      assertRepoAnnouncementCurrent(source, ["wss://metadata.test"], async () => [newer])
    ).rejects.toThrow(/settings changed/);
    await expect(
      assertRepoAnnouncementCurrent(source, ["wss://metadata.test"], async () => [newer], [
        newer.id,
      ])
    ).resolves.toBeUndefined();
    await expect(
      assertRepoAnnouncementCurrent(source, ["wss://metadata.test"], async () => [
        { ...newer, pubkey: "b".repeat(64) },
      ])
    ).resolves.toBeUndefined();
  });
});
