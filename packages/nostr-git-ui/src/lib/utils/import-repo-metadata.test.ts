import { describe, expect, it } from "vitest";

import {
  buildImportedRepoMetadata,
  buildImportedRepoEvents,
  getFinalRepoMetadataCreatedAt,
  getImportedRepoName,
  trackLatestRepoMetadataCreatedAt,
} from "./import-repo-metadata";

describe("import-repo-metadata", () => {
  it("bumps final repo metadata timestamps past provisional GRASP events", () => {
    expect(getFinalRepoMetadataCreatedAt(1000, 0)).toBe(1000);
    expect(getFinalRepoMetadataCreatedAt(1000, 1002)).toBe(1003);
  });

  it("tracks the latest provisional repo metadata timestamp", () => {
    const latest = trackLatestRepoMetadataCreatedAt(
      0,
      { created_at: 101 },
      { created_at: 109 },
      { created_at: 105 }
    );

    expect(latest).toBe(109);
  });

  it("derives destination repo names and metadata overrides", () => {
    const repo = {
      id: "1",
      name: "source-repo",
      fullName: "source/source-repo",
      defaultBranch: "main",
      isPrivate: false,
      cloneUrl: "https://github.com/source/source-repo.git",
      htmlUrl: "https://github.com/source/source-repo",
      owner: { login: "source", type: "User" as const },
    };

    expect(getImportedRepoName(repo, undefined)).toBe("source-repo");
    expect(getImportedRepoName(repo, "renamed-repo")).toBe("renamed-repo");
    expect(buildImportedRepoMetadata(repo, "renamed-repo")).toMatchObject({
      name: "renamed-repo",
      fullName: "source/renamed-repo",
    });
  });

  it("builds final repo metadata with all successful target URLs", () => {
    const { announcement, state } = buildImportedRepoEvents({
      repo: {
        id: "1",
        name: "flotilla-budabit",
        fullName: "source/flotilla-budabit",
        description: "Imported repo",
        defaultBranch: "main",
        isPrivate: false,
        cloneUrl: "https://github.com/source/flotilla-budabit.git",
        htmlUrl: "https://github.com/source/flotilla-budabit",
        owner: {
          login: "source",
          type: "User",
        },
      },
      relays: ["wss://relay.one"],
      userPubkey: "f".repeat(64),
      repoName: "renamed-budabit",
      importTimestamp: 2000,
      latestRepoMetadataCreatedAt: 2005,
      remotePushResults: [
        {
          success: true,
          remoteUrl:
            "https://gitnostr.com/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/flotilla-budabit.git",
          webUrl:
            "https://gitnostr.com/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/flotilla-budabit",
        },
        {
          success: true,
          remoteUrl: "https://github.com/me/flotilla-budabit.git",
          webUrl: "https://github.com/me/flotilla-budabit",
        },
        {
          success: true,
          remoteUrl: "https://gitlab.com/me/flotilla-budabit.git",
          webUrl: "https://gitlab.com/me/flotilla-budabit",
        },
        {
          success: false,
          remoteUrl: "https://bitbucket.org/me/flotilla-budabit.git",
          webUrl: "https://bitbucket.org/me/flotilla-budabit",
        },
      ],
      selectedBranchRefs: [{ name: "main", commit: "a".repeat(40) }],
    });

    const cloneTag = announcement.tags.find((tag) => tag[0] === "clone");
    const dTag = announcement.tags.find((tag) => tag[0] === "d");
    const webTag = announcement.tags.find((tag) => tag[0] === "web");
    const relayTag = state.tags.find((tag) => tag[0] === "relays");

    expect(announcement.created_at).toBe(2006);
    expect(state.created_at).toBe(2006);
    expect(dTag).toEqual(["d", "renamed-budabit"]);
    expect(cloneTag).toEqual([
      "clone",
      "https://gitnostr.com/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/flotilla-budabit.git",
      "https://github.com/me/flotilla-budabit.git",
      "https://gitlab.com/me/flotilla-budabit.git",
    ]);
    expect(webTag).toEqual([
      "web",
      "https://gitnostr.com/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/flotilla-budabit",
      "https://github.com/me/flotilla-budabit",
      "https://gitlab.com/me/flotilla-budabit",
    ]);
    expect(relayTag).toEqual(["relays", "wss://relay.one", "wss://gitnostr.com"]);
  });
});
