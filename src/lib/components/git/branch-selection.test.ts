import { describe, expect, it } from "vitest";

import { resolvePreferredBranchFromRefs } from "./branch-selection";

const heads = (...names: string[]) =>
  names.map((name) => ({ name, type: "heads" as const }));

describe("resolvePreferredBranchFromRefs", () => {
  it("restores a persisted branch when it still exists", () => {
    expect(
      resolvePreferredBranchFromRefs({
        refs: heads("add-logos", "main", "feature/local"),
        persistedBranch: "feature/local",
        headHint: "main",
      })
    ).toBe("feature/local");
  });

  it("selects the HEAD default instead of the first sorted branch", () => {
    expect(
      resolvePreferredBranchFromRefs({
        refs: heads("add-logos", "main"),
        headHint: "ref: refs/heads/main",
      })
    ).toBe("main");
  });

  it("ignores stale persisted branches and falls back to the default branch", () => {
    expect(
      resolvePreferredBranchFromRefs({
        refs: heads("add-logos", "main"),
        persistedBranch: "deleted-branch",
        headHint: "main",
      })
    ).toBe("main");
  });

  it("uses common defaults before falling back to the first branch", () => {
    expect(
      resolvePreferredBranchFromRefs({
        refs: heads("add-logos", "develop", "feature/x"),
      })
    ).toBe("develop");
  });

  it("falls back to the first branch only when no default signal exists", () => {
    expect(
      resolvePreferredBranchFromRefs({
        refs: heads("add-logos", "feature/x"),
      })
    ).toBe("add-logos");
  });
});
