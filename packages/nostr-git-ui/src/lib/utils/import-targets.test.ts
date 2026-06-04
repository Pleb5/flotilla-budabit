import { describe, expect, it } from "vitest";

import { findExistingTargetRepoConflict } from "./import-targets";

describe("findExistingTargetRepoConflict", () => {
  it("allows an exact existing target match", () => {
    const conflict = findExistingTargetRepoConflict({
      provider: "gitlab",
      requestedOwner: "Pleb5",
      requestedRepo: "blossy",
      existingRepo: {
        id: "1",
        name: "blossy",
        fullName: "Pleb5/blossy",
        defaultBranch: "main",
        isPrivate: false,
        cloneUrl: "https://gitlab.com/Pleb5/blossy.git",
        htmlUrl: "https://gitlab.com/Pleb5/blossy",
        owner: { login: "Pleb5", type: "User" },
      },
    });

    expect(conflict).toBeNull();
  });

  it("flags GitLab projects pending deletion", () => {
    const conflict = findExistingTargetRepoConflict({
      provider: "gitlab",
      requestedOwner: "Pleb5",
      requestedRepo: "rely",
      existingRepo: {
        id: "2",
        name: "rely-deletion_scheduled-80990844",
        fullName: "Pleb5/rely-deletion_scheduled-80990844",
        defaultBranch: "main",
        isPrivate: false,
        cloneUrl: "https://gitlab.com/Pleb5/rely-deletion_scheduled-80990844.git",
        htmlUrl: "https://gitlab.com/Pleb5/rely-deletion_scheduled-80990844",
        owner: { login: "Pleb5", type: "User" },
      },
    });

    expect(conflict).toEqual({
      reason: "pending_deletion",
      message:
        "GitLab has a project with this name pending deletion. Wait for deletion to finish or choose a different destination name.",
    });
  });

  it("flags mismatched existing targets returned by provider redirects", () => {
    const conflict = findExistingTargetRepoConflict({
      provider: "github",
      requestedOwner: "Pleb5",
      requestedRepo: "wanted-repo",
      existingRepo: {
        id: "3",
        name: "different-repo",
        fullName: "Pleb5/different-repo",
        defaultBranch: "main",
        isPrivate: false,
        cloneUrl: "https://github.com/Pleb5/different-repo.git",
        htmlUrl: "https://github.com/Pleb5/different-repo",
        owner: { login: "Pleb5", type: "User" },
      },
    });

    expect(conflict).toEqual({
      reason: "path_mismatch",
      message:
        "GitHub resolved this target name to Pleb5/different-repo. Review the destination name or remove the conflicting repository first.",
    });
  });
});
