import { describe, expect, it, vi } from "vitest";

import { syncLocalRepoToTargets } from "./remote-sync";

describe("syncLocalRepoToTargets", () => {
  it("uses configured web URLs for GRASP provisioning announcements", async () => {
    const commit = "c".repeat(40);
    let publishedAnnouncement: any;
    const workerApi = {
      createRemoteRepo: vi.fn(async () => ({
        success: true,
        remoteUrl: "https://relay.ngit.dev/npub1example/repo.git",
      })),
      pushToRemote: vi.fn(async () => ({ success: true })),
    };
    const onPublishEvent = vi.fn(async (event) => {
      if (event.kind === 30617) publishedAnnouncement = event;

      return {
        ackedRelays: ["wss://relay.ngit.dev"],
        failedRelays: [],
        successCount: 1,
        hasRelayOutcomes: true,
      };
    });

    const results = await syncLocalRepoToTargets({
      workerApi,
      localRepoId: "local/repo",
      repoName: "repo",
      repoDescription: "",
      defaultBranch: "main",
      refs: [{ type: "heads", name: "main", ref: "refs/heads/main", commit }],
      targets: [
        {
          id: "grasp:wss://relay.ngit.dev",
          label: "GRASP (relay.ngit.dev)",
          provider: "grasp",
          relayUrl: "wss://relay.ngit.dev",
        },
      ],
      userPubkey: "a".repeat(64),
      relays: ["wss://relay.ngit.dev"],
      webUrls: [
        "https://budabit.club/git/naddr1repo",
        "https://gitworkshop.dev/npub1example/repo",
      ],
      onPublishEvent,
      onFetchRelayEvents: vi.fn(async () => [
        {
          id: "evt-visible",
          kind: 30618,
          pubkey: "a".repeat(64),
          created_at: 1_717_171_717,
          tags: [
            ["d", "repo"],
            ["refs/heads/main", commit],
            ["HEAD", "ref: refs/heads/main"],
          ],
          content: "",
          sig: "sig",
        },
      ]),
      updateProgress: vi.fn(),
      runAbortable: async (operation, label) => {
        if (label.startsWith("Waiting for GRASP provisioning")) {
          throw new Error("skip provisioning wait");
        }
        return await operation();
      },
    });

    expect(results).toEqual([expect.objectContaining({ success: true })]);
    expect(publishedAnnouncement.tags).toEqual(
      expect.arrayContaining([
        [
          "web",
          "https://budabit.club/git/naddr1repo",
          "https://gitworkshop.dev/npub1example/repo",
        ],
      ])
    );
    expect(publishedAnnouncement.tags).not.toEqual(
      expect.arrayContaining([["web", "https://relay.ngit.dev/npub1example/repo"]])
    );
  });

  it("preserves created remote and failed ref details when the initial push is rejected", async () => {
    const workerApi = {
      createRemoteRepo: vi.fn(async () => ({
        success: true,
        remoteUrl: "https://github.com/alice/repo.git",
      })),
      pushToRemote: vi.fn(async () => ({
        success: false,
        error: "push declined due to repository rule violations",
        details: {
          pushedRefs: [],
          failedRefs: [
            {
              ref: "refs/heads/main",
              error: "refs/heads/main: push declined due to repository rule violations",
            },
          ],
          warnings: ["branch rule rejected refs/heads/main"],
        },
      })),
    };

    const results = await syncLocalRepoToTargets({
      workerApi,
      localRepoId: "local/repo",
      repoName: "repo",
      repoDescription: "",
      defaultBranch: "main",
      refs: [{ type: "heads", name: "main", ref: "refs/heads/main", commit: "a".repeat(40) }],
      targets: [
        {
          id: "git:github.com",
          label: "GitHub (github.com)",
          provider: "github",
          host: "github.com",
          token: "ghp_test",
        },
      ],
      userPubkey: "f".repeat(64),
      updateProgress: vi.fn(),
      runAbortable: async (operation) => await operation(),
    });

    expect(results).toEqual([
      expect.objectContaining({
        id: "git:github.com",
        success: false,
        remoteUrl: "https://github.com/alice/repo.git",
        createdRemote: true,
        failedRefs: [
          {
            ref: "refs/heads/main",
            error: "refs/heads/main: push declined due to repository rule violations",
          },
        ],
        warnings: ["branch rule rejected refs/heads/main"],
      }),
    ]);
  });

  it("preserves existing GRASP refs when publishing state for a pushed ref", async () => {
    let publishedState: any;
    const workerApi = {
      pushToRemote: vi.fn(async () => ({ success: true })),
    };
    const existingState = {
      id: "evt-existing",
      kind: 30618,
      pubkey: "a".repeat(64),
      created_at: 1_717_171_700,
      tags: [
        ["d", "repo"],
        ["refs/heads/main", "a".repeat(40)],
        ["refs/tags/v1.0.0", "b".repeat(40)],
        ["HEAD", "ref: refs/heads/main"],
      ],
      content: "",
      sig: "sig",
    };
    const onPublishEvent = vi.fn(async (event) => {
      publishedState = event;
      return {
        ackedRelays: ["wss://relay.ngit.dev"],
        failedRelays: [],
        successCount: 1,
        hasRelayOutcomes: true,
      };
    });
    const onFetchRelayEvents = vi.fn(async () => [publishedState || existingState]);

    const results = await syncLocalRepoToTargets({
      workerApi,
      localRepoId: "local/repo",
      repoName: "repo",
      repoDescription: "",
      defaultBranch: "main",
      refs: [
        {
          type: "heads",
          name: "feature",
          ref: "refs/heads/feature",
          commit: "c".repeat(40),
        },
      ],
      targets: [
        {
          id: "grasp:wss://relay.ngit.dev",
          label: "GRASP (relay.ngit.dev)",
          provider: "grasp",
          relayUrl: "wss://relay.ngit.dev",
          existingRemoteUrl:
            "https://relay.ngit.dev/npub1example/repo.git",
        },
      ],
      userPubkey: "a".repeat(64),
      onPublishEvent,
      onFetchRelayEvents,
      updateProgress: vi.fn(),
      runAbortable: async (operation) => await operation(),
    });

    expect(results).toEqual([
      expect.objectContaining({
        id: "grasp:wss://relay.ngit.dev",
        success: true,
        pushedRefs: ["refs/heads/feature"],
      }),
    ]);
    expect(publishedState.tags).toEqual(
      expect.arrayContaining([
        ["d", "repo"],
        ["refs/heads/main", "a".repeat(40)],
        ["refs/heads/feature", "c".repeat(40)],
        ["refs/tags/v1.0.0", "b".repeat(40)],
        ["HEAD", "ref: refs/heads/main"],
      ])
    );
    expect(workerApi.pushToRemote).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "grasp",
        ref: "refs/heads/feature",
      })
    );
  });
});
