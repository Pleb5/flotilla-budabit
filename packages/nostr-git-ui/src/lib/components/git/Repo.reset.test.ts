import { afterEach, describe, expect, it, vi } from "vitest";
import { readable } from "svelte/store";
import { Repo } from "./Repo.svelte";

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
