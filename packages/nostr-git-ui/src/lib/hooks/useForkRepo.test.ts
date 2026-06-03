import { describe, expect, it } from "vitest";

import {
  filterPreparedSourceRefs,
  getRollbackRemoteRepoTokens,
  type PreparedSourceRefs,
} from "./useForkRepo.svelte";

describe("filterPreparedSourceRefs", () => {
  it("preserves the default branch while filtering copied heads", () => {
    const preparedSource: PreparedSourceRefs = {
      defaultBranch: "main",
      branches: ["main", "feature", "release"],
      tags: ["v1.0.0"],
      refs: [
        { type: "heads", name: "main", ref: "refs/heads/main", commit: "a".repeat(40) },
        {
          type: "heads",
          name: "feature",
          ref: "refs/heads/feature",
          commit: "b".repeat(40),
        },
        {
          type: "heads",
          name: "release",
          ref: "refs/heads/release",
          commit: "c".repeat(40),
        },
        { type: "tags", name: "v1.0.0", ref: "refs/tags/v1.0.0", commit: "d".repeat(40) },
      ],
    };

    const result = filterPreparedSourceRefs({
      preparedSource,
      includeBranches: ["release"],
    });

    expect(result.defaultBranch).toBe("main");
    expect(result.branches).toEqual(["main", "release"]);
    expect(result.tags).toEqual(["v1.0.0"]);
    expect(result.refs).toEqual([
      { type: "heads", name: "main", ref: "refs/heads/main", commit: "a".repeat(40) },
      {
        type: "heads",
        name: "release",
        ref: "refs/heads/release",
        commit: "c".repeat(40),
      },
      { type: "tags", name: "v1.0.0", ref: "refs/tags/v1.0.0", commit: "d".repeat(40) },
    ]);
  });

  it("returns the original ref set when no branch filter is provided", () => {
    const preparedSource: PreparedSourceRefs = {
      defaultBranch: "main",
      branches: ["main"],
      tags: [],
      refs: [{ type: "heads", name: "main", ref: "refs/heads/main", commit: "a".repeat(40) }],
    };

    expect(filterPreparedSourceRefs({ preparedSource })).toEqual(preparedSource);
  });
});

describe("getRollbackRemoteRepoTokens", () => {
  it("tries the validated token followed by candidate tokens for platform rollback", () => {
    expect(
      getRollbackRemoteRepoTokens({
        id: "git:github.com",
        label: "GitHub (github.com)",
        provider: "github",
        token: "ghp_valid",
        tokens: ["ghp_valid", "ghp_fallback"],
      })
    ).toEqual(["ghp_valid", "ghp_fallback"]);
  });

  it("does not attempt remote API deletion for GRASP event-backed repos", () => {
    expect(
      getRollbackRemoteRepoTokens({
        id: "grasp:wss://relay.example",
        label: "GRASP (relay.example)",
        provider: "grasp",
        relayUrl: "wss://relay.example",
      })
    ).toEqual([]);
  });
});
