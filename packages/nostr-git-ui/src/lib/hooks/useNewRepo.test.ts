import { describe, expect, it } from "vitest";
import { getPublishedEventFromPublishResult } from "./useNewRepo.svelte";

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
