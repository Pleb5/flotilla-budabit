import { describe, expect, it, vi } from "vitest";
import { canUseInlineComments } from "./diff-viewer";

describe("diff-viewer helpers", () => {
  it("returns true only when comment context is fully available", () => {
    expect(
      canUseInlineComments({
        rootEvent: { id: "evt-1", tags: [] },
        onComment: vi.fn(),
        currentPubkey: "a".repeat(64),
      })
    ).toBe(true);
  });

  it("returns false when the root event is missing", () => {
    expect(
      canUseInlineComments({
        onComment: vi.fn(),
        currentPubkey: "a".repeat(64),
      })
    ).toBe(false);
  });

  it("returns false when the comment handler is missing", () => {
    expect(
      canUseInlineComments({
        rootEvent: { id: "evt-1", tags: [] },
        currentPubkey: "a".repeat(64),
      })
    ).toBe(false);
  });

  it("returns false when the current pubkey is unavailable", () => {
    expect(
      canUseInlineComments({
        rootEvent: { id: "evt-1", tags: [] },
        onComment: vi.fn(),
        currentPubkey: null,
      })
    ).toBe(false);
  });
});
