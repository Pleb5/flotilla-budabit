import { describe, expect, it, vi } from "vitest";

import { syncLocalRepoToTargets } from "./remote-sync";

describe("syncLocalRepoToTargets", () => {
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
});
