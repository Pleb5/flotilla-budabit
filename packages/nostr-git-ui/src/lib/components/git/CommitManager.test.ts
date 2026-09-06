import { describe, expect, it, vi } from "vitest";

import { CommitManager } from "./CommitManager";

describe("CommitManager", () => {
  it("asks the vendor router for enough commits when git fallback may paginate locally", async () => {
    const commits = Array.from({ length: 60 }, (_, index) => ({
      sha: `${String(index).padStart(2, "0")}${"a".repeat(38)}`,
      message: `Commit ${index}`,
      author: { name: "Alice", email: "alice@example.com", date: "2024-01-01T00:00:00Z" },
      committer: { name: "Alice", email: "alice@example.com", date: "2024-01-01T00:00:00Z" },
      parents: [],
    }));
    const vendorReadRouter = {
      listCommits: vi.fn(async () => ({
        commits,
        ref: "main",
        fromVendor: false,
        hasMore: true,
      })),
    };
    const workerManager = {} as any;
    const manager = new CommitManager(workerManager, undefined, {
      vendorReadRouter: vendorReadRouter as any,
      enableCaching: false,
      defaultCommitsPerPage: 30,
    });

    manager.setRepoKeys({ canonicalKey: "owner/repo", workerRepoId: "owner/repo" });
    manager.setRepoEvent({
      id: "repo-event",
      pubkey: "owner",
      tags: [["clone", "https://github.com/owner/repo.git"]],
    } as any);
    manager.setCurrentBranch("main", "main");

    const result = await manager.loadPage(2);

    expect(result.success).toBe(true);
    expect(result.commits).toHaveLength(30);
    expect(result.commits?.[0].oid).toBe(`30${"a".repeat(38)}`);
    expect(vendorReadRouter.listCommits).toHaveBeenCalledWith(
      expect.objectContaining({
        depth: 60,
        page: 2,
        perPage: 30,
      })
    );
  });

  it("does not bypass router clone authorization after a routed read fails", async () => {
    const vendorReadRouter = {
      listCommits: vi.fn(async () => {
        throw new Error("Git natural listCommits failed");
      }),
    };
    const workerManager = {
      getRepoDataLevel: vi.fn(),
      ensureFullClone: vi.fn(),
      getCommitHistory: vi.fn(),
    } as any;
    const manager = new CommitManager(workerManager, undefined, {
      vendorReadRouter: vendorReadRouter as any,
      enableCaching: false,
    });
    manager.setRepoKeys({ canonicalKey: "owner/repo", workerRepoId: "owner/repo" });
    manager.setRepoEvent({
      id: "repo-event",
      pubkey: "owner",
      tags: [["clone", "https://example.com/owner/repo.git"]],
    } as any);
    manager.setCurrentBranch("main", "main");

    const result = await manager.loadPage(1);

    expect(result.success).toBe(false);
    expect(workerManager.getRepoDataLevel).not.toHaveBeenCalled();
    expect(workerManager.ensureFullClone).not.toHaveBeenCalled();
    expect(workerManager.getCommitHistory).not.toHaveBeenCalled();
  });

  it("paginates from the first resolved OID when mirrors expose divergent branch tips", async () => {
    const snapshot = "b".repeat(40);
    const divergentTip = "c".repeat(40);
    const commits = Array.from({ length: 60 }, (_, index) => ({
      sha: `${index.toString(16).padStart(40, "0")}`,
      message: `Commit ${index}`,
      author: { name: "Alice", email: "alice@example.com", date: "2024-01-01T00:00:00Z" },
      committer: { name: "Alice", email: "alice@example.com", date: "2024-01-01T00:00:00Z" },
      parents: [],
    }));
    const listCommits = vi.fn(async ({ commitHash }: { commitHash?: string }) => ({
      commits,
      ref: "main",
      commitHash: commitHash || snapshot,
      fromVendor: false,
      hasMore: true,
      divergentTip,
    }));
    const manager = new CommitManager({} as any, undefined, {
      vendorReadRouter: { listCommits } as any,
      enableCaching: false,
      defaultCommitsPerPage: 30,
    });
    manager.setRepoKeys({ canonicalKey: "owner/repo", workerRepoId: "owner/repo" });
    manager.setRepoEvent({
      id: "repo-event",
      pubkey: "owner",
      tags: [["clone", "https://primary.example/repo.git", "https://mirror.example/repo.git"]],
    } as any);
    manager.setCurrentBranch("main", "main");

    await expect(manager.loadPage(1)).resolves.toMatchObject({ success: true });
    await expect(manager.loadPage(2)).resolves.toMatchObject({ success: true });

    expect(listCommits).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ commitHash: undefined })
    );
    expect(listCommits).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ commitHash: snapshot })
    );
    expect(manager.getCommits()).toHaveLength(60);
  });

  it("restarts page one instead of appending when the pinned history is unavailable", async () => {
    const firstSnapshot = "d".repeat(40);
    const replacementSnapshot = "e".repeat(40);
    const page = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        sha: `${prefix}${index.toString(16).padStart(39, "0")}`,
        message: `${prefix} ${index}`,
        author: { name: "Alice", email: "alice@example.com", date: "2024-01-01T00:00:00Z" },
        committer: {
          name: "Alice",
          email: "alice@example.com",
          date: "2024-01-01T00:00:00Z",
        },
        parents: [],
      }));
    const firstHistory = page("a", 60);
    const replacementHistory = page("b", 30);
    const listCommits = vi.fn(async ({ commitHash }: { commitHash?: string }) => {
      if (commitHash) throw new Error(`Pinned repository snapshot ${commitHash} is unavailable`);
      const replacement = listCommits.mock.calls.length > 2;
      return {
        commits: replacement ? replacementHistory : firstHistory,
        ref: "main",
        commitHash: replacement ? replacementSnapshot : firstSnapshot,
        fromVendor: false,
        hasMore: !replacement,
      };
    });
    const manager = new CommitManager({} as any, undefined, {
      vendorReadRouter: { listCommits } as any,
      enableCaching: false,
      defaultCommitsPerPage: 30,
    });
    manager.setRepoKeys({ canonicalKey: "owner/repo", workerRepoId: "owner/repo" });
    manager.setRepoEvent({
      id: "repo-event",
      pubkey: "owner",
      tags: [["clone", "https://primary.example/repo.git", "https://mirror.example/repo.git"]],
    } as any);
    manager.setCurrentBranch("main", "main");

    await manager.loadPage(1);
    const restarted = await manager.loadPage(2);

    expect(restarted).toMatchObject({ success: true });
    expect(manager.getCurrentPage()).toBe(1);
    expect(manager.getCommits()).toEqual(
      replacementHistory.map((commit) => expect.objectContaining({ oid: commit.sha }))
    );
    expect(listCommits.mock.calls.map(([request]) => request.commitHash)).toEqual([
      undefined,
      firstSnapshot,
      undefined,
    ]);
  });

  it("restores hasMore from an OID-keyed cached page", async () => {
    const snapshot = "f".repeat(40);
    const commits = Array.from({ length: 30 }, (_, index) => ({
      sha: index.toString(16).padStart(40, "0"),
      message: `Commit ${index}`,
      author: { name: "Alice", email: "alice@example.com", date: "2024-01-01T00:00:00Z" },
      committer: { name: "Alice", email: "alice@example.com", date: "2024-01-01T00:00:00Z" },
      parents: [],
    }));
    const cache = new Map<string, any>();
    const cacheManager = {
      registerCache: vi.fn(),
      get: vi.fn(async (_name: string, key: string) => cache.get(key)),
      set: vi.fn(async (_name: string, key: string, value: any) => cache.set(key, value)),
    } as any;
    const listCommits = vi.fn(async () => ({
      commits,
      ref: "main",
      commitHash: snapshot,
      fromVendor: false,
      hasMore: true,
    }));
    const manager = new CommitManager({} as any, cacheManager, {
      vendorReadRouter: { listCommits } as any,
      enableCaching: true,
      defaultCommitsPerPage: 30,
    });
    manager.setRepoKeys({ canonicalKey: "owner/repo", workerRepoId: "owner/repo" });
    manager.setRepoEvent({
      id: "repo-event",
      pubkey: "owner",
      tags: [["clone", "https://primary.example/repo.git"]],
    } as any);
    manager.setCurrentBranch("main", "main");

    await manager.loadPage(1);
    expect(manager.getHasMoreCommits()).toBe(true);
    await manager.loadPage(1);

    expect(listCommits).toHaveBeenCalledTimes(1);
    expect(manager.getHasMoreCommits()).toBe(true);
  });
});
