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
});
