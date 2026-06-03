import { describe, expect, it, vi } from "vitest";

import {
  disposeSubscriptions,
  getRepoStateEventsSignature,
  getRepoStateSnapshotSignature,
} from "./repo-runtime-utils";

describe("repo-runtime-utils", () => {
  it("builds a stable signature from repo-state event metadata", () => {
    const signature = getRepoStateEventsSignature([
      { id: "state-1", created_at: 10, pubkey: "alice" } as any,
      { id: "state-2", created_at: 11, pubkey: "bob" } as any,
    ]);
    const reversed = getRepoStateEventsSignature([
      { id: "state-2", created_at: 11, pubkey: "bob" } as any,
      { id: "state-1", created_at: 10, pubkey: "alice" } as any,
    ]);

    expect(signature).toBe("state-1:10:alice|state-2:11:bob");
    expect(reversed).toBe(signature);
  });

  it("normalizes repo-state snapshot refs regardless of input order", () => {
    const first = getRepoStateSnapshotSignature([
      {
        name: "release/v1",
        type: "tags",
        fullRef: "refs/tags/release/v1",
        commitId: "bbbb",
      },
      {
        name: "main",
        type: "heads",
        fullRef: "refs/heads/main",
        commitId: "aaaa",
      },
    ]);

    const second = getRepoStateSnapshotSignature([
      {
        name: "main",
        type: "heads",
        fullRef: "refs/heads/main",
        commitId: "aaaa",
      },
      {
        name: "release/v1",
        type: "tags",
        fullRef: "refs/tags/release/v1",
        commitId: "bbbb",
      },
    ]);

    expect(first).toBe(second);
  });

  it("runs all unsubs in reverse order and ignores unsubscribe errors", () => {
    const calls: string[] = [];
    const first = vi.fn(() => {
      calls.push("first");
    });
    const second = vi.fn(() => {
      calls.push("second");
      throw new Error("boom");
    });
    const third = vi.fn(() => {
      calls.push("third");
    });

    disposeSubscriptions([first, second, third]);

    expect(calls).toEqual(["third", "second", "first"]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
  });
});
