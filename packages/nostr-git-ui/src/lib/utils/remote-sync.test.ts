import { describe, expect, it, vi } from "vitest";

import { syncLocalRepoToTargets } from "./remote-sync";

function signedEvent(event: any) {
  return {
    ...event,
    id: `${event.kind}-${event.created_at}`,
    pubkey: event.pubkey || "a".repeat(64),
    sig: event.sig || "signature",
  };
}

describe("syncLocalRepoToTargets", () => {
  it("uses configured web URLs for GRASP provisioning announcements", async () => {
    const commit = "c".repeat(40);
    const featureCommit = "d".repeat(40);
    let publishedAnnouncement: any;
    const publishedStates: any[] = [];
    const operations: string[] = [];
    const workerApi = {
      createRemoteRepo: vi.fn(async () => ({
        success: true,
        remoteUrl: "https://relay.ngit.dev/npub1example/repo.git",
      })),
      pushToRemote: vi.fn(async () => {
        operations.push("push");
        return { success: true };
      }),
      listServerRefs: vi.fn(async () => [
        { ref: "refs/heads/main", oid: commit },
        { ref: "refs/heads/feature", oid: featureCommit },
      ]),
    };
    const onPublishEvent = vi.fn(async (event) => {
      operations.push(event.kind === 30617 ? "publish-announcement" : "publish-state");
      const signed = signedEvent(event);
      if (event.kind === 30617) publishedAnnouncement = signed;
      if (event.kind === 30618) {
        publishedStates.push(signed);
      }

      return {
        event: signed,
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
      refs: [
        { type: "heads", name: "main", ref: "refs/heads/main", commit },
        {
          type: "heads",
          name: "feature",
          ref: "refs/heads/feature",
          commit: featureCommit,
        },
      ],
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
      webUrls: ["https://budabit.club/git/naddr1repo", "https://gitworkshop.dev/npub1example/repo"],
      onPublishEvent,
      onFetchRelayEvents: vi.fn(async ({ filters }) => {
        if (filters.some((filter) => filter.ids)) {
          operations.push("readback");
          return [publishedAnnouncement, ...publishedStates].filter(Boolean);
        }
        return [];
      }),
      updateProgress: vi.fn(),
      runAbortable: async (operation, label) => {
        if (label.startsWith("Waiting for GRASP provisioning")) {
          return undefined as Awaited<ReturnType<typeof operation>>;
        }
        if (label.startsWith("Waiting for GRASP receive-pack")) {
          return undefined as Awaited<ReturnType<typeof operation>>;
        }
        return await operation();
      },
    });

    expect(results).toEqual([expect.objectContaining({ success: true })]);
    expect(workerApi.createRemoteRepo).not.toHaveBeenCalled();
    expect(publishedAnnouncement.tags).toEqual(
      expect.arrayContaining([
        ["web", "https://budabit.club/git/naddr1repo", "https://gitworkshop.dev/npub1example/repo"],
      ])
    );
    expect(publishedAnnouncement.tags).not.toEqual(
      expect.arrayContaining([["web", "https://relay.ngit.dev/npub1example/repo"]])
    );
    expect(publishedAnnouncement.tags).toEqual(
      expect.arrayContaining([["relays", "wss://relay.ngit.dev"]])
    );
    expect(onPublishEvent.mock.calls.every((call) => call[1]?.relays === undefined)).toBe(false);
    expect(onPublishEvent.mock.calls.map((call) => call[1]?.relays)).toEqual([
      ["wss://relay.ngit.dev"],
      ["wss://relay.ngit.dev"],
      ["wss://relay.ngit.dev"],
    ]);
    expect(operations).toEqual([
      "publish-announcement",
      "publish-state",
      "push",
      "readback",
      "readback",
      "publish-state",
      "push",
      "readback",
    ]);
    expect(publishedStates).toHaveLength(2);
    expect(publishedStates[1].tags).toEqual(
      expect.arrayContaining([
        ["refs/heads/main", commit],
        ["refs/heads/feature", featureCommit],
      ])
    );
    expect(publishedStates[1].created_at).toBeGreaterThan(publishedStates[0].created_at);
  });

  it("fails before Git push when GRASP publication callbacks are unavailable", async () => {
    const workerApi = {
      pushToRemote: vi.fn(async () => ({ success: true })),
    };

    const results = await syncLocalRepoToTargets({
      workerApi,
      localRepoId: "local/repo",
      repoName: "repo",
      repoDescription: "",
      defaultBranch: "main",
      refs: [
        {
          type: "heads",
          name: "main",
          ref: "refs/heads/main",
          commit: "a".repeat(40),
        },
      ],
      targets: [
        {
          id: "grasp:wss://relay.ngit.dev",
          label: "GRASP (relay.ngit.dev)",
          provider: "grasp",
          relayUrl: "wss://relay.ngit.dev",
          existingRemoteUrl: "https://relay.ngit.dev/npub1example/repo.git",
        },
      ],
      userPubkey: "a".repeat(64),
      updateProgress: vi.fn(),
      runAbortable: async (operation) => await operation(),
    });

    expect(results).toEqual([
      expect.objectContaining({
        success: false,
        error: "Missing onPublishEvent callback required for GRASP sync",
      }),
    ]);
    expect(workerApi.pushToRemote).not.toHaveBeenCalled();
  });

  it("fails before publication or Git push when a GRASP ref has no resolved commit", async () => {
    const workerApi = {
      pushToRemote: vi.fn(async () => ({ success: true })),
    };
    const onPublishEvent = vi.fn();

    const results = await syncLocalRepoToTargets({
      workerApi,
      localRepoId: "local/repo",
      repoName: "repo",
      repoDescription: "",
      defaultBranch: "main",
      refs: [{ type: "heads", name: "main", ref: "refs/heads/main" }],
      targets: [
        {
          id: "grasp:wss://relay.ngit.dev",
          label: "GRASP (relay.ngit.dev)",
          provider: "grasp",
          relayUrl: "wss://relay.ngit.dev",
          existingRemoteUrl: "https://relay.ngit.dev/npub1example/repo.git",
        },
      ],
      userPubkey: "a".repeat(64),
      onPublishEvent,
      onFetchRelayEvents: vi.fn().mockResolvedValue([]),
      updateProgress: vi.fn(),
      runAbortable: async (operation) => await operation(),
    });

    expect(results).toEqual([
      expect.objectContaining({
        success: false,
        error: "Cannot verify refs/heads/main without a resolved commit",
      }),
    ]);
    expect(onPublishEvent).not.toHaveBeenCalled();
    expect(workerApi.pushToRemote).not.toHaveBeenCalled();
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

  it("deletes only a transaction-created platform repository verified to be empty", async () => {
    const workerApi = {
      createRemoteRepo: vi.fn(async () => ({
        success: true,
        remoteUrl: "https://github.com/alice/repo.git",
      })),
      pushToRemote: vi.fn(async () => ({
        success: false,
        error: "push rejected",
        details: { pushedRefs: [], failedRefs: [] },
      })),
      listServerRefs: vi.fn(async () => []),
      deleteRemoteRepo: vi.fn(async () => ({ success: true })),
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

    expect(results[0]).toEqual(
      expect.objectContaining({
        success: false,
        outcome: "failed",
        cleanup: { attempted: true, success: true },
      })
    );
    expect(workerApi.deleteRemoteRepo).toHaveBeenCalledWith({
      remoteUrl: "https://github.com/alice/repo.git",
      token: "ghp_test",
      provider: "github",
      baseUrl: undefined,
    });
  });

  it("does not delete a created platform repository after an ambiguous timeout", async () => {
    const workerApi = {
      createRemoteRepo: vi.fn(async () => ({
        success: true,
        remoteUrl: "https://github.com/alice/repo.git",
      })),
      pushToRemote: vi.fn(async () => {
        throw new Error("network timeout while waiting for receive-pack");
      }),
      listServerRefs: vi.fn(async () => []),
      deleteRemoteRepo: vi.fn(async () => ({ success: true })),
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

    expect(results[0]).toEqual(
      expect.objectContaining({
        success: false,
        outcome: "unknown",
        cleanup: undefined,
      })
    );
    expect(workerApi.deleteRemoteRepo).not.toHaveBeenCalled();
  });

  it("returns accumulated target results when cancellation occurs between targets", async () => {
    const commit = "a".repeat(40);
    const workerApi = {
      pushToRemote: vi.fn(async () => ({ success: true })),
      listServerRefs: vi.fn(async ({ url }) =>
        url.includes("alice") ? [{ ref: "refs/heads/main", oid: commit }] : []
      ),
    };

    const results = await syncLocalRepoToTargets({
      workerApi,
      localRepoId: "local/repo",
      repoName: "repo",
      repoDescription: "",
      defaultBranch: "main",
      refs: [{ type: "heads", name: "main", ref: "refs/heads/main", commit }],
      targets: [
        {
          id: "git:github.com:alice",
          label: "GitHub (alice)",
          provider: "github",
          host: "github.com",
          token: "ghp_test",
          existingRemoteUrl: "https://github.com/alice/repo.git",
        },
        {
          id: "git:github.com:bob",
          label: "GitHub (bob)",
          provider: "github",
          host: "github.com",
          token: "ghp_test",
          existingRemoteUrl: "https://github.com/bob/repo.git",
        },
      ],
      userPubkey: "f".repeat(64),
      updateProgress: vi.fn(),
      runAbortable: async (operation) => await operation(),
      throwIfAborted: () => {
        if (workerApi.pushToRemote.mock.calls.length > 0) throw new Error("Fork cancelled");
      },
    });

    expect(results).toEqual([
      expect.objectContaining({ id: "git:github.com:alice", success: true }),
      expect.objectContaining({
        id: "git:github.com:bob",
        success: false,
        outcome: "unknown",
        error: "Fork cancelled",
      }),
    ]);
  });

  it("requires exact advertised refs after a reported platform push success", async () => {
    const commit = "a".repeat(40);
    const workerApi = {
      createRemoteRepo: vi.fn(async () => ({
        success: true,
        remoteUrl: "https://github.com/alice/repo.git",
      })),
      pushToRemote: vi.fn(async () => ({ success: true })),
      listServerRefs: vi.fn(async () => [{ ref: "refs/heads/main", oid: "b".repeat(40) }]),
      deleteRemoteRepo: vi.fn(),
    };

    const results = await syncLocalRepoToTargets({
      workerApi,
      localRepoId: "local/repo",
      repoName: "repo",
      repoDescription: "",
      defaultBranch: "main",
      refs: [{ type: "heads", name: "main", ref: "refs/heads/main", commit }],
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

    expect(results[0]).toEqual(
      expect.objectContaining({
        success: false,
        outcome: "failed",
        error:
          "Remote ref postflight verification failed: refs/heads/main (pushed 1/1 refs before failure)",
      })
    );
    expect(workerApi.deleteRemoteRepo).not.toHaveBeenCalled();
  });

  it("accepts an annotated tag when its peeled advertised ref matches", async () => {
    const commit = "a".repeat(40);
    const workerApi = {
      createRemoteRepo: vi.fn(async () => ({
        success: true,
        remoteUrl: "https://github.com/alice/repo.git",
      })),
      pushToRemote: vi.fn(async () => ({ success: true })),
      listServerRefs: vi.fn(async () => [
        { ref: "refs/tags/v1.0.0", oid: "b".repeat(40) },
        { ref: "refs/tags/v1.0.0^{}", oid: commit },
      ]),
    };

    const results = await syncLocalRepoToTargets({
      workerApi,
      localRepoId: "local/repo",
      repoName: "repo",
      repoDescription: "",
      defaultBranch: "main",
      refs: [{ type: "tags", name: "v1.0.0", ref: "refs/tags/v1.0.0", commit }],
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

    expect(results[0]).toEqual(
      expect.objectContaining({ success: true, pushedRefs: ["refs/tags/v1.0.0"] })
    );
  });

  it("continues from an empty platform failure to a verified GRASP survivor", async () => {
    const commit = "a".repeat(40);
    let publishedAnnouncement: any;
    let publishedState: any;
    const workerApi = {
      createRemoteRepo: vi.fn(async () => ({
        success: true,
        remoteUrl: "https://github.com/alice/repo.git",
      })),
      pushToRemote: vi.fn(async ({ provider }) =>
        provider === "github" ? { success: false, error: "push rejected" } : { success: true }
      ),
      listServerRefs: vi.fn(async ({ url }) =>
        url.includes("relay.ngit.dev") ? [{ ref: "refs/heads/main", oid: commit }] : []
      ),
      deleteRemoteRepo: vi.fn(async () => ({ success: true })),
    };
    const onPublishEvent = vi.fn(async (event) => {
      const signed = signedEvent(event);
      if (event.kind === 30617) publishedAnnouncement = signed;
      if (event.kind === 30618) publishedState = signed;
      return {
        event: signed,
        ackedRelays: ["wss://relay.ngit.dev"],
        failedRelays: [],
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
          id: "git:github.com",
          label: "GitHub (github.com)",
          provider: "github",
          host: "github.com",
          token: "ghp_test",
        },
        {
          id: "grasp:wss://relay.ngit.dev",
          label: "GRASP (relay.ngit.dev)",
          provider: "grasp",
          relayUrl: "wss://relay.ngit.dev",
        },
      ],
      userPubkey: "f".repeat(64),
      onPublishEvent,
      onFetchRelayEvents: vi.fn(async ({ filters }) =>
        filters.some((filter) => filter.ids)
          ? [publishedAnnouncement, publishedState].filter(Boolean)
          : []
      ),
      updateProgress: vi.fn(),
      runAbortable: async (operation, label) =>
        label.startsWith("Waiting for GRASP receive-pack")
          ? (undefined as Awaited<ReturnType<typeof operation>>)
          : await operation(),
    });

    expect(results).toEqual([
      expect.objectContaining({
        provider: "github",
        success: false,
        cleanup: { attempted: true, success: true },
      }),
      expect.objectContaining({
        provider: "grasp",
        success: true,
        pushedRefs: ["refs/heads/main"],
      }),
    ]);
  });

  it("recovers an ambiguous GRASP push when refs and metadata pass postflight", async () => {
    const commit = "a".repeat(40);
    let publishedAnnouncement: any;
    let publishedState: any;
    const workerApi = {
      pushToRemote: vi.fn(async () => {
        throw new Error("network timeout after receive-pack");
      }),
      listServerRefs: vi.fn(async () => [{ ref: "refs/heads/main", oid: commit }]),
    };
    const onPublishEvent = vi.fn(async (event) => {
      const signed = signedEvent(event);
      if (event.kind === 30617) publishedAnnouncement = signed;
      if (event.kind === 30618) publishedState = signed;
      return {
        event: signed,
        ackedRelays: ["wss://relay.ngit.dev"],
        failedRelays: [],
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
      userPubkey: "f".repeat(64),
      onPublishEvent,
      onFetchRelayEvents: vi.fn(async ({ filters }) =>
        filters.some((filter) => filter.ids)
          ? [publishedAnnouncement, publishedState].filter(Boolean)
          : []
      ),
      updateProgress: vi.fn(),
      runAbortable: async (operation, label) =>
        label.startsWith("Waiting for GRASP receive-pack")
          ? (undefined as Awaited<ReturnType<typeof operation>>)
          : await operation(),
    });

    expect(results[0]).toEqual(
      expect.objectContaining({
        success: true,
        outcome: "ok",
        pushedRefs: ["refs/heads/main"],
        warnings: expect.arrayContaining([
          "Push reported failure but every requested remote ref was verified",
        ]),
      })
    );
  });

  it("preserves existing GRASP refs when publishing state for a pushed ref", async () => {
    let publishedState: any;
    const workerApi = {
      pushToRemote: vi.fn(async () => ({ success: true })),
      listServerRefs: vi.fn(async () => [{ ref: "refs/heads/feature", oid: "c".repeat(40) }]),
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
      publishedState = signedEvent(event);
      return {
        event: publishedState,
        ackedRelays: ["wss://relay.ngit.dev"],
        failedRelays: [],
        successCount: 1,
        hasRelayOutcomes: true,
      };
    });
    const onFetchRelayEvents = vi.fn(async ({ filters }) =>
      filters.some((filter) => filter.ids) ? [publishedState].filter(Boolean) : [existingState]
    );

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
          existingRemoteUrl: "https://relay.ngit.dev/npub1example/repo.git",
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
