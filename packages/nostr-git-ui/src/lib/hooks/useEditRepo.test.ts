import { describe, expect, it, vi } from "vitest";

import { getEditRepoRelays, publishEditedRepoEvents } from "./useEditRepo.svelte";

const announcement = (relays: string[]) =>
  ({
    id: "a".repeat(64),
    sig: "b".repeat(128),
    pubkey: "c".repeat(64),
    kind: 30617,
    created_at: 1,
    content: "",
    tags: [
      ["d", "repo"],
      ["name", "repo"],
      ["description", "desc"],
      ["clone", "https://github.com/alice/repo.git"],
      ["relays", ...relays],
    ],
  }) as any;

const state = {
  id: "d".repeat(64),
  sig: "e".repeat(128),
  pubkey: "c".repeat(64),
  kind: 30618,
  created_at: 1,
  content: "",
  tags: [
    ["d", "repo"],
    ["HEAD", "ref: refs/heads/main"],
    ["refs/heads/main", "f".repeat(40)],
  ],
} as any;

describe("useEditRepo repository relay scope", () => {
  it("fails before signer or publisher work when the announcement has no relays", async () => {
    const onSignEvent = vi.fn();
    const onPublishEvent = vi.fn();

    await expect(
      publishEditedRepoEvents({
        announcementEvent: announcement([]),
        stateEvent: state,
        repoRelays: getEditRepoRelays(announcement([])),
        onSignEvent,
        onPublishEvent,
      })
    ).rejects.toThrow("Repository edit requires relays from the accepted announcement");

    expect(onSignEvent).not.toHaveBeenCalled();
    expect(onPublishEvent).not.toHaveBeenCalled();
  });

  it("publishes announcement and state to the exact normalized accepted relays", async () => {
    const currentAnnouncement = announcement([
      " WSS://REPO.EXAMPLE/path/ ",
      "wss://repo.example/path",
    ]);
    const repoRelays = getEditRepoRelays(currentAnnouncement);
    const onSignEvent = vi.fn(async (event: any) => ({
      ...event,
      id: `${event.kind}`.padEnd(64, "0"),
      sig: "1".repeat(128),
      pubkey: "c".repeat(64),
    }));
    const onPublishEvent = vi.fn(async () => ({
      ackedRelays: ["wss://repo.example/path"],
      failedRelays: [],
      successCount: 1,
      hasRelayOutcomes: true,
    }));
    const announcementEvent = {
      ...currentAnnouncement,
      tags: currentAnnouncement.tags.map((tag: string[]) =>
        tag[0] === "relays" ? ["relays", ...repoRelays] : tag
      ),
    };

    await publishEditedRepoEvents({
      announcementEvent,
      stateEvent: state,
      repoRelays,
      onSignEvent,
      onPublishEvent,
    });

    expect(repoRelays).toEqual(["wss://repo.example/path"]);
    expect(onPublishEvent).toHaveBeenCalledTimes(2);
    expect(onPublishEvent.mock.calls.map((call) => call[1])).toEqual([
      { relays: ["wss://repo.example/path"] },
      { relays: ["wss://repo.example/path"] },
    ]);
    expect(onPublishEvent.mock.calls[0][0].tags).toContainEqual([
      "relays",
      "wss://repo.example/path",
    ]);
  });
});
