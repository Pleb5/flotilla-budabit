import { describe, expect, it, vi } from "vitest";
import type { NostrEvent } from "@nostr-git/core";
import type { PublicRepoSource } from "@nostr-git/core/git";
import { findSourceAnnouncements, loadOwnerRepoAnnouncements } from "./repo-import-checks.js";

const owner = "a".repeat(64);
const source = {
  provider: "forgejo",
  cloneUrl: "https://codeberg.org/team/repo.git",
} as PublicRepoSource;
const event = (overrides: Partial<NostrEvent> = {}): NostrEvent => ({
  kind: 30617,
  pubkey: owner,
  id: "event",
  sig: "fixture",
  created_at: 10,
  content: "",
  tags: [
    ["d", "existing"],
    ["name", "Existing repo"],
    ["clone", source.cloneUrl],
  ],
  ...overrides,
});

describe("public import announcement checks", () => {
  it.each([
    "https://codeberg.org/team/repo",
    "https://codeberg.org/team/repo.git/",
    "git@codeberg.org:team/repo.git",
    "ssh://git@codeberg.org/team/repo.git",
  ])("recognizes equivalent clone URL %s", (clone) => {
    expect(
      findSourceAnnouncements(source, owner, [
        event({
          tags: [
            ["d", "existing"],
            ["clone", "https://elsewhere.test/team/repo", clone],
          ],
        }),
      ])
    ).toEqual([{ identifier: "existing", name: "existing" }]);
  });
  it("uses the latest owner announcement, exact host/path, and every clone tag", () => {
    const changed = event({
      id: "changed",
      created_at: 11,
      tags: [
        ["d", "existing"],
        ["clone", "https://codeberg.org/team/other.git"],
      ],
    });
    expect(
      findSourceAnnouncements(source, owner, [event(), changed, event({ pubkey: "b".repeat(64) })])
    ).toEqual([]);
    expect(
      findSourceAnnouncements(source, owner, [
        event({
          tags: [
            ["d", "legacy:identifier"],
            ["clone", "https://codeberg.org/team/other"],
            ["clone", source.cloneUrl],
          ],
        }),
      ])
    ).toEqual([{ identifier: "legacy:identifier", name: "legacy:identifier" }]);
    for (const url of [
      "https://fake-codeberg.org/team/repo.git",
      "https://codeberg.org/team/repo-extra.git",
    ])
      expect(
        findSourceAnnouncements(source, owner, [
          event({
            tags: [
              ["d", "x"],
              ["clone", url],
            ],
          }),
        ])
      ).toEqual([]);
  });
  it("handles GitHub case-insensitivity and GitLab subgroup clone URLs", () => {
    expect(
      findSourceAnnouncements(
        { provider: "github", cloneUrl: "https://github.com/Owner/Repo.git" } as PublicRepoSource,
        owner,
        [
          event({
            tags: [
              ["d", "x"],
              ["clone", "git@github.com:owner/repo"],
            ],
          }),
        ]
      )
    ).toHaveLength(1);
    expect(
      findSourceAnnouncements(
        {
          provider: "gitlab",
          cloneUrl: "https://gitlab.com/group/team/repo.git",
        } as PublicRepoSource,
        owner,
        [
          event({
            tags: [
              ["d", "x"],
              ["clone", "ssh://git@gitlab.com/group/team/repo"],
            ],
          }),
        ]
      )
    ).toHaveLength(1);
  });
  it("combines cached announcements with every lookup relay and paginates full responses", async () => {
    const page = Array.from({ length: 200 }, (_, i) =>
      event({ id: `page-${i}`, created_at: 500 - i, tags: [["d", `page-${i}`]] })
    );
    const fetchEvents = vi.fn(async ({ relays, filters }) =>
      relays[0].includes("one")
        ? filters[0].until === undefined
          ? page
          : [page.at(-1)!, event()]
        : [event({ id: "other", tags: [["d", "other"]] })]
    );
    const records = await loadOwnerRepoAnnouncements({
      owner,
      relays: ["wss://one.test", "wss://two.test/", "wss://one.test/"],
      knownEvents: [event({ id: "cache", tags: [["d", "cached"]] })],
      fetchEvents,
    });
    expect(fetchEvents).toHaveBeenCalledTimes(3);
    expect(fetchEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        relays: ["wss://one.test/"],
        filters: [{ kinds: [30617], authors: [owner], limit: 200, until: 301 }],
        throwOnTimeout: true,
      })
    );
    expect(records.events).toHaveLength(203);
    expect(records.checkedRelays).toEqual(["wss://one.test/", "wss://two.test/"]);
    expect(records.failedRelays).toEqual([]);
    expect(findSourceAnnouncements(source, owner, records.events)).toEqual([
      { identifier: "existing", name: "Existing repo" },
    ]);
  });
  it("reports unavailable and incomplete inventories instead of claiming no duplicates", async () => {
    const fetchEvents = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const params = { owner, relays: ["wss://relay.test/"], fetchEvents };
    expect(await loadOwnerRepoAnnouncements(params)).toMatchObject({
      checkedRelays: [],
      failedRelays: [{ relay: "wss://relay.test/", error: "offline" }],
    });
    fetchEvents.mockResolvedValue(Array.from({ length: 200 }, (_, i) => event({ id: `${i}` })));
    expect((await loadOwnerRepoAnnouncements(params)).failedRelays[0].error).toContain(
      "could not be fully checked"
    );
    fetchEvents.mockImplementation(async ({ relays }) => {
      if (relays[0].includes("offline")) throw new Error("timeout");
      return [event()];
    });
    const partial = await loadOwnerRepoAnnouncements({
      ...params,
      relays: ["wss://offline.test/", "wss://relay.test/"],
    });
    expect(partial.checkedRelays).toEqual(["wss://relay.test/"]);
    expect(partial.failedRelays).toEqual([{ relay: "wss://offline.test/", error: "timeout" }]);
    expect(findSourceAnnouncements(source, owner, partial.events)).toHaveLength(1);
  });
  it("ignores an aborted result and rechecks the actor after relay reads", async () => {
    const controller = new AbortController();
    await expect(
      loadOwnerRepoAnnouncements({
        owner,
        relays: ["wss://relay.test/"],
        signal: controller.signal,
        fetchEvents: async () => {
          controller.abort();
          return [event()];
        },
      })
    ).rejects.toThrow();
    const assertActor = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementation(() => {
        throw new Error("account changed");
      });
    await expect(
      loadOwnerRepoAnnouncements({
        owner,
        relays: ["wss://relay.test/"],
        assertActor,
        fetchEvents: async () => [],
      })
    ).rejects.toThrow("account changed");
  });
  it("keeps duplicate evidence received before a relay read fails", async () => {
    const result = await loadOwnerRepoAnnouncements({
      owner,
      relays: ["wss://partial.test"],
      fetchEvents: async ({ onEvent }) => {
        onEvent?.(event());
        throw new Error("disconnected before EOSE");
      },
    });
    expect(result.checkedRelays).toEqual([]);
    expect(result.failedRelays).toHaveLength(1);
    expect(findSourceAnnouncements(source, owner, result.events)).toHaveLength(1);
  });
});
