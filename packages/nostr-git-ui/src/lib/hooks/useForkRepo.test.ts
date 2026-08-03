import { describe, expect, it } from "vitest";

import {
  filterPreparedSourceRefs,
  getForkRemoteSyncWarning,
  getRollbackRemoteRepoTokens,
  getSelectedGraspSourceUrls,
  hasForkLocalRollbackResource,
  isSameLogicalRepoAugmentation,
  type PreparedSourceRefs,
} from "./useForkRepo.svelte";

describe("isSameLogicalRepoAugmentation", () => {
  const ownerPubkey = "a".repeat(64);
  const sourceEvent = (identifier: string, pubkey = ownerPubkey, kind = 30617) => ({
    kind,
    pubkey,
    tags: [["d", identifier]],
  });

  it("recognizes an unchanged coordinate owned by the current user", () => {
    expect(
      isSameLogicalRepoAugmentation({
        sourceAnnouncementEvent: sourceEvent("zap-stream-core"),
        destinationName: "zap-stream-core",
        userPubkey: ownerPubkey,
      })
    ).toBe(true);
  });

  it("keeps renamed and different-owner destinations on the new-fork path", () => {
    expect(
      isSameLogicalRepoAugmentation({
        sourceAnnouncementEvent: sourceEvent("zap-stream-core"),
        destinationName: "zap-stream-core-fork",
        userPubkey: ownerPubkey,
      })
    ).toBe(false);
    expect(
      isSameLogicalRepoAugmentation({
        sourceAnnouncementEvent: sourceEvent("zap-stream-core"),
        destinationName: "zap-stream-core",
        userPubkey: "b".repeat(64),
      })
    ).toBe(false);
  });

  it("uses the authoritative event identifier instead of display or clone names", () => {
    expect(
      isSameLogicalRepoAugmentation({
        sourceAnnouncementEvent: sourceEvent("repo-coordinate"),
        destinationName: "clone-name",
        userPubkey: ownerPubkey,
      })
    ).toBe(false);
    expect(
      isSameLogicalRepoAugmentation({
        sourceAnnouncementEvent: sourceEvent("repo-coordinate"),
        destinationName: "repo-coordinate",
        userPubkey: ownerPubkey,
      })
    ).toBe(true);
  });

  it("fails closed when authoritative event identity is unavailable", () => {
    expect(
      isSameLogicalRepoAugmentation({
        sourceAnnouncementEvent: {
          kind: 30617,
          pubkey: ownerPubkey,
          tags: [],
        },
        destinationName: "zap-stream-core",
        userPubkey: ownerPubkey,
      })
    ).toBe(false);
    expect(
      isSameLogicalRepoAugmentation({
        sourceAnnouncementEvent: sourceEvent("zap-stream-core", ownerPubkey, 1),
        destinationName: "zap-stream-core",
        userPubkey: ownerPubkey,
      })
    ).toBe(false);
  });
});

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

describe("hasForkLocalRollbackResource", () => {
  it("does not roll back a mirror before local creation starts", () => {
    expect(hasForkLocalRollbackResource("local/repo", "planned")).toBe(false);
    expect(hasForkLocalRollbackResource("local/repo", "cleaned")).toBe(false);
  });

  it("rolls back a mirror after local creation may have started", () => {
    expect(hasForkLocalRollbackResource("local/repo", "creating")).toBe(true);
    expect(hasForkLocalRollbackResource("local/repo", "created")).toBe(true);
    expect(hasForkLocalRollbackResource(null, "created")).toBe(false);
  });
});

describe("augmentation result metadata", () => {
  it("removes selected GRASP source URLs from the preserved set", () => {
    const ownerPubkey = "a".repeat(64);
    const ownerNpub = "npub1424242424242424242424242424242424242424242424242424qamrcaj";
    const budabitClone = `https://grasp.budabit.club/${ownerNpub}/embit.git`;
    const budabitWeb = budabitClone.replace(/\.git$/, "");

    expect(
      getSelectedGraspSourceUrls({
        cloneUrls: ["https://github.com/Pleb5/embit.git", budabitClone],
        webUrls: ["https://github.com/Pleb5/embit", budabitWeb],
        targets: [
          {
            id: "grasp:wss://grasp.budabit.club",
            label: "GRASP",
            provider: "grasp",
            relayUrl: "wss://grasp.budabit.club",
          },
        ],
        ownerPubkey,
        identifier: "embit",
      })
    ).toEqual({ cloneUrls: [budabitClone], webUrls: [budabitWeb] });

    const splitClone = `https://git.example/${ownerNpub}/embit.git`;
    const splitWeb = `https://browse.example/${ownerNpub}/embit`;
    expect(
      getSelectedGraspSourceUrls({
        cloneUrls: [splitClone],
        webUrls: [splitWeb],
        targets: [
          {
            id: "grasp:wss://events.example",
            label: "GRASP",
            provider: "grasp",
            relayUrl: "wss://events.example",
          },
        ],
        knownGraspServices: [
          {
            relayUrl: "wss://events.example",
            httpBaseAliases: ["https://git.example", "https://browse.example"],
            sources: ["nip11"],
          },
        ],
        ownerPubkey,
        identifier: "embit",
      })
    ).toEqual({
      cloneUrls: [splitClone],
      webUrls: [splitWeb],
    });
  });

  it("recomputes partial-success warnings from final reconciled results", () => {
    expect(
      getForkRemoteSyncWarning([
        { id: "one", label: "One", provider: "grasp", success: true },
        {
          id: "two",
          label: "Two",
          provider: "grasp",
          success: false,
          error: "metadata did not stabilize",
        },
      ])
    ).toBe("Synced 1/2 targets. Failed: Two (metadata did not stabilize)");
    expect(
      getForkRemoteSyncWarning([{ id: "one", label: "One", provider: "grasp", success: true }])
    ).toBeNull();
  });
});
