import { afterEach, describe, expect, it, vi } from "vitest";
import { readable, writable } from "svelte/store";
import { nip19 } from "nostr-tools";
import { Repo } from "./Repo.svelte";
import { tokens } from "$lib/stores/tokens";
import { orderReadUrlsByPreference, updateUrlPreferenceCache } from "@nostr-git/core/utils";

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.assign(globalThis, {
    $state: <T>(value: T) => value,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
});

vi.mock("$lib/stores/tokens", () => ({
  tokens: {
    subscribe: vi.fn((callback: (tokens: unknown[]) => void) => {
      callback([]);
      return () => {};
    }),
    waitForInitialization: vi.fn().mockResolvedValue([]),
  },
}));

describe("Repo reset", () => {
  it("anchors storage and announcement edits to d, not to the display name or foreign announcements", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const owner = "a".repeat(64);
    const announcement = {
      kind: 30617,
      pubkey: owner,
      id: "original",
      sig: "fixture",
      created_at: 1,
      content: "Keep content",
      tags: [
        ["d", "Legacy.Case"],
        ["clone", "https://github.com/fixture/Legacy.Case.git"],
        ["future", "retain"],
      ],
    } as any;
    const events = writable(announcement);
    const viewer = writable<string | null>(owner);
    const repo = new Repo({
      repoEvent: events,
      repoStateEvent: readable(undefined as any),
      issues: readable([]),
      viewerPubkey: viewer,
      workerManager: {
        isReady: false,
        setProgressCallback: vi.fn(),
        setAuthConfig: vi.fn().mockResolvedValue(undefined),
        initialize: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      } as any,
    });
    await repo.waitForReady();
    try {
      const key = repo.key;
      expect(repo.name).toBe("Legacy.Case");
      expect(key).toContain("/Legacy.Case");
      const edited = repo.createRepoAnnouncementEvent({ name: "名前 with spaces" });
      expect(edited.tags).toContainEqual(["d", "Legacy.Case"]);
      expect(edited.tags).toContainEqual(["future", "retain"]);
      events.set({ ...edited, id: "replacement", sig: "fixture" });
      expect(repo.key).toBe(key);
      expect(repo.name).toBe("名前 with spaces");
      events.set({ ...announcement, id: "foreign", pubkey: "b".repeat(64) });
      expect(repo.repoEvent?.id).toBe("replacement");
      viewer.set("b".repeat(64));
      expect(() => repo.createRepoAnnouncementEvent({ name: "Forbidden" })).toThrow(/owner/);
    } finally {
      repo.dispose();
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finishes local cleanup and then propagates a remote reset failure", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resetError = new Error("remote reset failed");
    const workerManager = {
      isReady: false,
      setProgressCallback: vi.fn(),
      setAuthConfig: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      syncWithRemote: vi.fn().mockResolvedValue(undefined),
      resetRepoToRemote: vi.fn().mockRejectedValue(resetError),
      dispose: vi.fn(),
    };
    const repo = new Repo({
      repoEvent: readable(undefined as any),
      repoStateEvent: readable(undefined as any),
      issues: readable([]),
      workerManager: workerManager as any,
    });

    await repo.waitForReady();
    repo.cacheManager.dispose();
    repo.commitManager.dispose();
    repo.branchManager.dispose();
    repo.fileManager.dispose();

    const clearCache = vi.fn().mockResolvedValue(undefined);
    const clearMergeCache = vi.fn().mockResolvedValue(undefined);
    const loadAllRefs = vi.fn().mockResolvedValue(undefined);
    repo.cacheManager = {
      clear: clearCache,
      dispose: vi.fn(),
    } as any;
    repo.mergeAnalysisCacheManager = { clear: clearMergeCache } as any;
    repo.commitManager = { reset: vi.fn(), setCloneUrls: vi.fn(), dispose: vi.fn() } as any;
    repo.branchManager = {
      reset: vi.fn(),
      getMainBranch: vi.fn(() => "main"),
      getSelectedBranch: vi.fn(() => undefined),
      getStats: vi.fn(() => ({ mainBranch: "main", selectedBranch: undefined })),
      setRepoEvent: vi.fn(),
      setSelectedBranch: vi.fn(),
      loadAllRefs,
      getAllRefs: vi.fn(() => []),
      getRefDiscoverySource: vi.fn(() => null),
      setCloneUrls: vi.fn(),
      dispose: vi.fn(),
    } as any;
    repo.fileManager = {
      clearCache: vi.fn().mockResolvedValue(undefined),
      setCloneUrls: vi.fn(),
      dispose: vi.fn(),
    } as any;
    repo.repoEvent = {
      id: "repo-event",
      pubkey: "a".repeat(64),
      kind: 30617,
      created_at: 1,
      content: "",
      tags: [["d", "repo"]],
      sig: "",
    } as any;
    repo.key = "owner/repo";
    const cloneUrls = ["https://primary.example/repo.git", "https://fallback.example/repo.git"];
    repo.setCloneUrls(cloneUrls);
    updateUrlPreferenceCache("owner/repo", cloneUrls[1], [cloneUrls[0]]);
    repo.recordCloneUrlError(cloneUrls[0], "network failed", undefined, {
      errorCode: "network-error",
      operation: "listDirectory",
      kind: "connectivity",
    });
    repo.recordReadFallback({
      operation: "listDirectory",
      activeFallbackUrl: cloneUrls[1],
      failures: [
        {
          url: cloneUrls[0],
          error: "network failed",
          errorCode: "network-error",
          kind: "connectivity",
        },
      ],
    });

    await expect(repo.reset()).rejects.toBe(resetError);

    expect(workerManager.resetRepoToRemote).toHaveBeenCalledWith("owner/repo", "main");
    expect(repo.fileManager.clearCache).toHaveBeenCalled();
    expect(clearMergeCache).toHaveBeenCalled();
    expect(clearCache).toHaveBeenCalledTimes(4);
    expect(loadAllRefs).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("Git reset to remote failed:", resetError);
    expect(orderReadUrlsByPreference(cloneUrls, "owner/repo")).toEqual(cloneUrls);
    expect(repo.currentReadRemoteUrl).toBe(cloneUrls[0]);
    expect(repo.cloneUrlErrors).toEqual([]);
    expect(repo.readFallbackObservation).toBeNull();

    repo.dispose();
  });

  it("separates endpoint issues from read fallback and does not rewind the cursor", async () => {
    vi.mocked(tokens.waitForInitialization).mockResolvedValue([]);
    const workerManager = {
      isReady: false,
      setProgressCallback: vi.fn(),
      setAuthConfig: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    };
    const repo = new Repo({
      repoEvent: readable(undefined as any),
      repoStateEvent: readable(undefined as any),
      issues: readable([]),
      workerManager: workerManager as any,
    });
    await repo.waitForReady();
    repo.key = "owner/repo";
    repo.currentReadRemoteUrl = "https://primary.example/repo.git";
    updateUrlPreferenceCache("owner/repo", "https://secondary.example/repo.git", [
      "https://primary.example/repo.git",
    ]);

    repo.recordCloneUrlError("https://primary.example/repo.git", "primary failed", undefined, {
      errorCode: "network-error",
      operation: "listDirectory",
      kind: "connectivity",
    });

    expect(repo.currentReadRemoteUrl).toBe("https://primary.example/repo.git");
    expect(repo.cloneUrlErrors[0]).toMatchObject({
      errorCode: "network-error",
      operation: "listDirectory",
      kind: "connectivity",
    });

    repo.recordReadFallback({
      operation: "listDirectory",
      activeFallbackUrl: "https://secondary.example/repo.git",
      failures: [
        {
          url: "https://primary.example/repo.git",
          error: "pack parser failed",
          errorCode: "protocol-error",
          kind: "parser",
        },
      ],
    });

    repo.recordReadFallback({
      operation: "getFileContent",
      activeFallbackUrl: "https://secondary.example/repo.git",
      failures: [],
    });

    expect(repo.currentReadRemoteUrl).toBe("https://secondary.example/repo.git");
    expect(repo.readFallbackObservation).toMatchObject({
      operation: "listDirectory",
      failures: [expect.objectContaining({ errorCode: "protocol-error" })],
    });
    repo.recordCloneUrlSuccess("https://primary.example/repo.git");
    expect(repo.currentReadRemoteUrl).toBe("https://secondary.example/repo.git");
    expect(
      orderReadUrlsByPreference(
        ["https://primary.example/repo.git", "https://secondary.example/repo.git"],
        "owner/repo"
      )
    ).toEqual(["https://secondary.example/repo.git"]);
    repo.dispose();
  });

  it("does not present the final failed cursor as an active fallback", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(tokens.waitForInitialization).mockResolvedValue([]);
    const repo = new Repo({
      repoEvent: readable(undefined as any),
      repoStateEvent: readable(undefined as any),
      issues: readable([]),
      workerManager: {
        isReady: false,
        setProgressCallback: vi.fn(),
        setAuthConfig: vi.fn().mockResolvedValue(undefined),
        initialize: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      } as any,
    });
    await repo.waitForReady();
    repo.key = "owner/all-failed";
    repo.currentReadRemoteUrl = "https://primary.example/repo.git";
    updateUrlPreferenceCache(repo.key, "https://secondary.example/repo.git", [
      "https://primary.example/repo.git",
    ]);

    repo.recordReadFallback({
      operation: "listRefs",
      failures: [
        {
          url: "https://secondary.example/repo.git",
          error: "request failed",
          errorCode: "network-error",
          kind: "connectivity",
        },
      ],
    });

    expect(repo.currentReadRemoteUrl).toBe("");
    expect(repo.readFallbackObservation?.activeFallbackUrl).toBeUndefined();
    repo.dispose();
  });

  it("ignores fallback observations behind the authoritative read cursor", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(tokens.waitForInitialization).mockResolvedValue([]);
    const cloneUrls = [
      "https://primary.example/repo.git",
      "https://secondary.example/repo.git",
      "https://tertiary.example/repo.git",
    ];
    const repo = new Repo({
      repoEvent: readable(undefined as any),
      repoStateEvent: readable(undefined as any),
      issues: readable([]),
      workerManager: {
        isReady: false,
        setProgressCallback: vi.fn(),
        setAuthConfig: vi.fn().mockResolvedValue(undefined),
        initialize: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      } as any,
    });
    await repo.waitForReady();
    repo.key = "owner/concurrent";
    repo.setCloneUrls(cloneUrls);
    updateUrlPreferenceCache(repo.key, cloneUrls[2], cloneUrls.slice(0, 2));
    repo.recordReadFallback({
      operation: "listRefs",
      activeFallbackUrl: cloneUrls[2],
      failures: [],
    });

    repo.recordReadFallback({
      operation: "listDirectory",
      activeFallbackUrl: cloneUrls[1],
      failures: [
        {
          url: cloneUrls[0],
          error: "pack parser failed",
          errorCode: "protocol-error",
          kind: "parser",
        },
      ],
    });

    expect(repo.currentReadRemoteUrl).toBe(cloneUrls[2]);
    expect(repo.readFallbackObservation).toEqual({
      operation: "listRefs",
      activeFallbackUrl: cloneUrls[2],
      failures: [],
    });

    repo.recordReadFallback({
      operation: "listDirectory",
      activeFallbackUrl: cloneUrls[2],
      failures: [
        {
          url: cloneUrls[0],
          error: "pack parser failed",
          errorCode: "protocol-error",
          kind: "parser",
        },
      ],
    });
    repo.setCloneUrls([cloneUrls[1], cloneUrls[2], cloneUrls[0]]);

    expect(repo.currentReadRemoteUrl).toBe(cloneUrls[2]);
    expect(repo.readFallbackObservation).toEqual({
      operation: "listDirectory",
      activeFallbackUrl: cloneUrls[2],
      failures: [],
    });

    repo.setCloneUrls(cloneUrls.slice(1));
    repo.recordReadFallback({
      operation: "getFileContent",
      activeFallbackUrl: cloneUrls[0],
      failures: [{ url: cloneUrls[1], error: "late failure", kind: "connectivity" }],
    });
    expect(repo.currentReadRemoteUrl).toBe(cloneUrls[2]);
    expect(repo.readFallbackObservation).toEqual({
      operation: "listDirectory",
      activeFallbackUrl: cloneUrls[2],
      failures: [],
    });

    repo.recordReadFallback({
      operation: "listRefs",
      failures: [{ url: cloneUrls[0], error: "late primary failure", kind: "connectivity" }],
    });
    expect(repo.currentReadRemoteUrl).toBe(cloneUrls[2]);
    expect(repo.readFallbackObservation).toEqual({
      operation: "listDirectory",
      activeFallbackUrl: cloneUrls[2],
      failures: [],
    });

    repo.recordReadFallback({
      operation: "diff",
      failures: [
        { url: cloneUrls[1], error: "secondary failed", kind: "connectivity" },
        { url: cloneUrls[2], error: "tertiary failed", kind: "connectivity" },
      ],
    });
    expect(repo.currentReadRemoteUrl).toBe("");
    expect(repo.readFallbackObservation?.failures).toHaveLength(2);

    repo.recordReadFallback({
      operation: "listRefs",
      activeFallbackUrl: cloneUrls[2],
      failures: [],
    });

    repo.clearReadFallbackObservation();
    repo.setCloneUrls([cloneUrls[1]]);
    expect(repo.currentReadRemoteUrl).toBe(cloneUrls[1]);
    repo.recordCloneUrlSuccess(cloneUrls[0]);
    expect(repo.currentReadRemoteUrl).toBe(cloneUrls[1]);
    repo.dispose();
  });
});

describe("Repo initialization reads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const announcement = {
    id: "1".repeat(64),
    pubkey: "a".repeat(64),
    kind: 30617,
    created_at: 1,
    content: "",
    tags: [
      ["d", "repo"],
      ["name", "repo"],
      ["clone", "https://relay.ngit.dev/owner/repo.git"],
    ],
    sig: "2".repeat(128),
  } as any;

  function createRepo(isCloned: boolean) {
    vi.mocked(tokens.waitForInitialization).mockResolvedValue([]);
    let finishInitialize!: () => void;
    const initializePromise = new Promise<void>((resolve) => {
      finishInitialize = resolve;
    });
    const workerManager = {
      isReady: false,
      setProgressCallback: vi.fn(),
      setAuthConfig: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn(() => initializePromise),
      isRepoCloned: vi.fn().mockResolvedValue(isCloned),
      syncWithRemote: vi.fn().mockResolvedValue({ success: true }),
      dispose: vi.fn(),
    };
    const repo = new Repo({
      repoEvent: readable(announcement),
      repoStateEvent: readable(undefined as any),
      issues: readable([]),
      workerManager: workerManager as any,
    });

    repo.refs = [
      {
        name: "main",
        type: "heads",
        fullRef: "refs/heads/main",
        commitId: "3".repeat(40),
      },
    ];
    vi.spyOn(repo.branchManager, "getStats").mockReturnValue({
      mainBranch: "main",
      selectedBranch: "main",
    } as any);

    return { repo, workerManager, finishInitialize };
  }

  it("does not probe or sync an uncloned repository before routed reads", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { repo, workerManager, finishInitialize } = createRepo(false);

    finishInitialize();
    await repo.waitForReady();

    expect(workerManager.isRepoCloned).not.toHaveBeenCalled();
    expect(workerManager.syncWithRemote).not.toHaveBeenCalled();
    repo.dispose();
  });

  it("does not sync an existing local clone before routed reads", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { repo, workerManager, finishInitialize } = createRepo(true);

    finishInitialize();
    await repo.waitForReady();

    expect(workerManager.isRepoCloned).not.toHaveBeenCalled();
    expect(workerManager.syncWithRemote).not.toHaveBeenCalled();
    repo.dispose();
  });
});

describe("Repo ref discovery status", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const announcement = {
    id: "1".repeat(64),
    pubkey: "a".repeat(64),
    kind: 30617,
    created_at: 1,
    content: "",
    tags: [
      ["d", "repo"],
      ["name", "repo"],
      ["clone", "https://github.com/owner/repo.git"],
    ],
    sig: "2".repeat(128),
  } as any;

  const createWorkerManager = (initialize: () => Promise<void>) => {
    vi.mocked(tokens.waitForInitialization).mockResolvedValue([]);
    return {
      isReady: false,
      setProgressCallback: vi.fn(),
      setAuthConfig: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn(initialize),
      dispose: vi.fn(),
    };
  };

  it("does not report unavailable while refs for a late announcement are loading", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const announcementStore = writable(undefined as any);
    const workerManager = createWorkerManager(() => Promise.resolve());
    const repo = new Repo({
      repoEvent: announcementStore,
      repoStateEvent: readable(undefined as any),
      issues: readable([]),
      workerManager: workerManager as any,
    });

    await repo.waitForReady();
    workerManager.isReady = true;
    expect(repo.refDiscoveryStatus).toBe("idle");
    expect(repo.isRefDiscoveryUnavailable).toBe(false);

    let finishRefDiscovery!: (result: any) => void;
    vi.spyOn(repo.vendorReadRouter, "listRefs").mockReturnValue(
      new Promise((resolve) => {
        finishRefDiscovery = resolve;
      })
    );

    announcementStore.set(announcement);

    expect(repo.refDiscoveryStatus).toBe("loading");
    expect(repo.isRefDiscoveryUnavailable).toBe(false);

    finishRefDiscovery({
      refs: [
        {
          name: "main",
          type: "heads",
          fullRef: "refs/heads/main",
          commitId: "3".repeat(40),
        },
      ],
      defaultBranch: "main",
      fromVendor: true,
      source: { kind: "provider-rest", label: "Provider REST API" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(repo.refDiscoveryStatus).toBe("resolved");
    expect(repo.defaultBranch).toBe("main");
    expect(repo.isRefDiscoveryUnavailable).toBe(false);
    repo.dispose();
  });

  it("waits for repository-state discovery before reporting empty refs", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let finishInitialize!: () => void;
    const initializePromise = new Promise<void>((resolve) => {
      finishInitialize = resolve;
    });
    const repoStateDiscoveryPending = writable(true);
    const workerManager = createWorkerManager(() => initializePromise);
    const repo = new Repo({
      repoEvent: readable(announcement),
      repoStateEvent: readable(undefined as any),
      repoStateDiscoveryPending,
      issues: readable([]),
      workerManager: workerManager as any,
    });
    vi.spyOn(repo.vendorReadRouter, "listRefs").mockResolvedValue({
      refs: [],
      fromVendor: true,
      source: { kind: "provider-rest", label: "Provider REST API" },
    } as any);

    workerManager.isReady = true;
    finishInitialize();
    await repo.waitForReady();

    expect(repo.refDiscoveryStatus).toBe("empty");
    expect(repo.isRefDiscoveryUnavailable).toBe(false);

    repoStateDiscoveryPending.set(false);

    expect(repo.isRefDiscoveryUnavailable).toBe(true);
    repo.dispose();
  });
});

describe("Repo state authority", () => {
  const maintainer = "b".repeat(64);
  const announcement = {
    id: "1".repeat(64),
    pubkey: "a".repeat(64),
    kind: 30617,
    created_at: 1,
    content: "",
    tags: [
      ["d", "repo"],
      ["maintainers", nip19.npubEncode(maintainer)],
    ],
    sig: "2".repeat(128),
  } as any;
  const state = {
    id: "3".repeat(64),
    pubkey: maintainer,
    kind: 30618,
    created_at: 2,
    content: "",
    tags: [["d", "repo"]],
    sig: "4".repeat(128),
  } as any;

  const makeWorkerManager = () => ({
    isReady: false,
    setProgressCallback: vi.fn(),
    setAuthConfig: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn(() => new Promise<void>(() => {})),
    dispose: vi.fn(),
  });

  it("normalizes npub maintainers for single-state subscriptions", () => {
    const stateStore = writable(undefined as any);
    const repo = new Repo({
      repoEvent: readable(announcement),
      repoStateEvent: stateStore,
      issues: readable([]),
      workerManager: makeWorkerManager() as any,
    });

    stateStore.set(state);

    expect(repo.repoStateEvent?.id).toBe(state.id);
    repo.dispose();
  });

  it("normalizes npub maintainers when admitting a pending state", () => {
    const announcementStore = writable(undefined as any);
    const repo = new Repo({
      repoEvent: announcementStore,
      repoStateEvent: readable(state),
      issues: readable([]),
      workerManager: makeWorkerManager() as any,
    });

    announcementStore.set(announcement);

    expect(repo.repoStateEvent?.id).toBe(state.id);
    repo.dispose();
  });
});
