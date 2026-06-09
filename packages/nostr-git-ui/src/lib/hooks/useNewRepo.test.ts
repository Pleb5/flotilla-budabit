import { describe, expect, it } from "vitest";
import { getPublishedEventFromPublishResult, selectNewRepoWebUrls } from "./useNewRepo.svelte";

describe("getPublishedEventFromPublishResult", () => {
  it("returns the signed event from a publish thunk result", () => {
    const event = {
      id: "event-id",
      sig: "sig",
      kind: 30617,
      pubkey: "p".repeat(64),
      created_at: 1,
      tags: [["d", "repo"]],
      content: "",
    };

    expect(getPublishedEventFromPublishResult({ event })).toBe(event);
  });

  it("ignores publish results without a signed event id", () => {
    expect(getPublishedEventFromPublishResult({ successCount: 1 })).toBeUndefined();
    expect(
      getPublishedEventFromPublishResult({ event: { tags: [["d", "repo"]] } })
    ).toBeUndefined();
  });
});

describe("selectNewRepoWebUrls", () => {
  it("keeps only Budabit and GitWorkshop URLs in Budabit-first order", () => {
    expect(
      selectNewRepoWebUrls([
        "https://gitworkshop.dev/npub1owner/flotilla-budabit",
        "https://relay.ngit.dev/npub1owner/flotilla-budabit",
        "https://github.com/me/flotilla-budabit",
        "https://budabit.club/git/naddr1repo",
      ])
    ).toEqual([
      "https://budabit.club/git/naddr1repo",
      "https://gitworkshop.dev/npub1owner/flotilla-budabit",
    ]);
  });

  it("recognizes local app repo paths as Budabit links", () => {
    expect(
      selectNewRepoWebUrls([
        "https://localhost:5173/git/naddr1repo",
        "https://gitnostr.com/npub1owner/flotilla-budabit",
        "gitworkshop.dev/npub1owner/flotilla-budabit",
      ])
    ).toEqual([
      "https://localhost:5173/git/naddr1repo",
      "gitworkshop.dev/npub1owner/flotilla-budabit",
    ]);
  });
});
