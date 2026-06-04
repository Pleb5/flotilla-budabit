import { describe, expect, it } from "vitest";

import {
  buildRemoteTargetOptions,
  getDefaultSelectedRemoteTargetIds,
  validateRemoteTargetRepoName,
} from "./remote-targets";

describe("remote target helpers", () => {
  it("builds git and GRASP target seeds", () => {
    const targets = buildRemoteTargetOptions({
      tokenList: [
        { host: "github.com", token: "ghp_example" },
        { host: "gitlab.com", token: "glpat-example" },
      ],
      graspRelayUrls: ["wss://relay.example"],
    });

    expect(targets).toEqual([
      expect.objectContaining({ id: "git:github.com", provider: "github", status: "checking" }),
      expect.objectContaining({ id: "git:gitlab.com", provider: "gitlab", status: "checking" }),
      expect.objectContaining({
        id: "grasp:wss://relay.example",
        provider: "grasp",
        status: "checking",
      }),
    ]);
  });

  it("defaults to all ready GRASP targets before falling back to git targets", () => {
    const selectedIds = getDefaultSelectedRemoteTargetIds([
      { id: "git:github.com", label: "GitHub", provider: "github", status: "ready" },
      { id: "git:gitlab.com", label: "GitLab", provider: "gitlab", status: "ready" },
      { id: "grasp:wss://one", label: "GRASP One", provider: "grasp", status: "ready" },
      { id: "grasp:wss://two", label: "GRASP Two", provider: "grasp", status: "ready" },
      { id: "git:bitbucket.org", label: "Bitbucket", provider: "bitbucket", status: "failed" },
    ]);

    expect(selectedIds).toEqual(["grasp:wss://one", "grasp:wss://two"]);
  });

  it("falls back to ready git targets when no GRASP targets are ready", () => {
    const selectedIds = getDefaultSelectedRemoteTargetIds([
      { id: "git:github.com", label: "GitHub", provider: "github", status: "ready" },
      { id: "git:gitlab.com", label: "GitLab", provider: "gitlab", status: "ready" },
      { id: "grasp:wss://one", label: "GRASP One", provider: "grasp", status: "failed" },
    ]);

    expect(selectedIds).toEqual(["git:github.com", "git:gitlab.com"]);
  });

  it("validates remote target repository names", () => {
    expect(validateRemoteTargetRepoName("")).toBe("Destination repository name is required");
    expect(validateRemoteTargetRepoName("bad/name")).toBe(
      "Destination repository name cannot contain / or \\\\"
    );
    expect(validateRemoteTargetRepoName("good-name")).toBeUndefined();
  });
});
