import { describe, expect, it } from "vitest";
import { resolveLoadPageBranch } from "./load-page-branch";

describe("resolveLoadPageBranch", () => {
  it("prefers the selected branch over the stored branch", () => {
    expect(
      resolveLoadPageBranch({
        selectedBranch: "feature/fix",
        storedBranch: "main",
        mainBranch: "develop",
      })
    ).toBe("feature/fix");
  });

  it("falls back to the stored branch when no selected branch is present", () => {
    expect(
      resolveLoadPageBranch({
        selectedBranch: "",
        storedBranch: "release",
        mainBranch: "main",
      })
    ).toBe("release");
  });

  it("falls back to the main branch when selected and stored branches are empty", () => {
    expect(
      resolveLoadPageBranch({
        selectedBranch: "   ",
        storedBranch: undefined,
        mainBranch: "main",
      })
    ).toBe("main");
  });
});
