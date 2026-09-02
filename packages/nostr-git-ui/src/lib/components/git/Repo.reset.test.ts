import { afterEach, describe, expect, it, vi } from "vitest";
import { readable, writable } from "svelte/store";
import { nip19 } from "nostr-tools";
import { Repo } from "./Repo.svelte";
import { tokens } from "$lib/stores/tokens";

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
    repo.commitManager = { reset: vi.fn(), dispose: vi.fn() } as any;
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
      dispose: vi.fn(),
    } as any;
    repo.fileManager = {
      clearCache: vi.fn().mockResolvedValue(undefined),
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

    await expect(repo.reset()).rejects.toBe(resetError);

    expect(workerManager.resetRepoToRemote).toHaveBeenCalledWith("owner/repo", "main");
    expect(repo.fileManager.clearCache).toHaveBeenCalled();
    expect(clearMergeCache).toHaveBeenCalled();
    expect(clearCache).toHaveBeenCalledTimes(4);
    expect(loadAllRefs).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("Git reset to remote failed:", resetError);

    repo.dispose();
  });
});

describe("Repo initialization sync", () => {
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

  it("does not sync a repository that has not been cloned locally", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { repo, workerManager, finishInitialize } = createRepo(false);

    finishInitialize();
    await repo.waitForReady();

    expect(workerManager.isRepoCloned).toHaveBeenCalledWith({ repoId: repo.key });
    expect(workerManager.syncWithRemote).not.toHaveBeenCalled();
    repo.dispose();
  });

  it("syncs an existing local clone", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { repo, workerManager, finishInitialize } = createRepo(true);

    finishInitialize();
    await repo.waitForReady();

    expect(workerManager.syncWithRemote).toHaveBeenCalledWith({
      repoId: repo.key,
      cloneUrls: ["https://relay.ngit.dev/owner/repo.git"],
      branch: "main",
    });
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
    tags: [["d", "repo"], ["maintainers", nip19.npubEncode(maintainer)]],
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
