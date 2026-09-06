import { describe, expect, it, vi } from "vitest";

import { FileManager, RepositorySnapshotUnavailableError } from "./FileManager";

const repoEvent = {
  id: "repo-event",
  pubkey: "owner",
  tags: [
    ["d", "repo"],
    ["clone", "https://primary.example/repo.git", "https://mirror.example/repo.git"],
  ],
} as any;

describe("FileManager immutable snapshots", () => {
  it("shares a fully shaped in-flight result for concurrent tag listings", async () => {
    const commit = "a".repeat(40);
    let release!: (value: any) => void;
    const routedResult = new Promise((resolve) => {
      release = resolve;
    });
    const vendorReadRouter = { listDirectory: vi.fn(() => routedResult) };
    const manager = new FileManager({} as any, undefined, {
      vendorReadRouter: vendorReadRouter as any,
      enableCaching: false,
    });

    const first = manager.listRepoFilesAtCommit({ repoEvent, commit });
    const second = manager.listRepoFilesAtCommit({ repoEvent, commit });
    release({
      files: [{ path: "README.md", type: "file", oid: "b".repeat(40) }],
      path: "",
      ref: commit,
      commitHash: commit,
      fromVendor: false,
    });

    await expect(first).resolves.toEqual(
      expect.objectContaining({
        files: [expect.objectContaining({ path: "README.md" })],
        path: "",
        ref: commit,
        commitHash: commit,
      })
    );
    await expect(second).resolves.toEqual(await first);
    expect(vendorReadRouter.listDirectory).toHaveBeenCalledTimes(1);
  });

  it("pins child directory and file reads to the first resolved branch OID", async () => {
    const snapshot = "c".repeat(40);
    const listDirectory = vi.fn(async ({ path, commitHash }: any) => ({
      files: [{ path: path ? `${path}/child.txt` : "src", type: path ? "file" : "directory" }],
      path,
      ref: "main",
      commitHash: commitHash || snapshot,
      fromVendor: false,
    }));
    const getFileContent = vi.fn(async ({ path, commitHash }: any) => ({
      content: "pinned\n",
      path,
      ref: "main",
      commitHash,
      encoding: "utf-8",
      size: 7,
      fromVendor: false,
    }));
    const manager = new FileManager({} as any, undefined, {
      vendorReadRouter: { listDirectory, getFileContent } as any,
      enableCaching: false,
    });

    await manager.listRepoFiles({ repoEvent, repoKey: "owner/repo", branch: "main" });
    await manager.listRepoFiles({
      repoEvent,
      repoKey: "owner/repo",
      branch: "main",
      path: "src",
    });
    await manager.getFileContent({
      repoEvent,
      repoKey: "owner/repo",
      branch: "main",
      path: "src/child.txt",
    });

    expect(listDirectory).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ commitHash: snapshot })
    );
    expect(getFileContent).toHaveBeenCalledWith(expect.objectContaining({ commitHash: snapshot }));
  });

  it("fails the pinned operation instead of returning a divergent mirror snapshot", async () => {
    const firstSnapshot = "d".repeat(40);
    const secondSnapshot = "e".repeat(40);
    const listDirectory = vi
      .fn()
      .mockResolvedValueOnce({
        files: [{ path: "src", type: "directory" }],
        path: "",
        ref: "main",
        commitHash: firstSnapshot,
        fromVendor: false,
      })
      .mockResolvedValueOnce({
        files: [{ path: "different.txt", type: "file" }],
        path: "src",
        ref: "main",
        commitHash: secondSnapshot,
        fromVendor: false,
      });
    const manager = new FileManager({} as any, undefined, {
      vendorReadRouter: { listDirectory } as any,
      enableCaching: false,
    });

    await manager.listRepoFiles({ repoEvent, repoKey: "owner/repo", branch: "main" });
    await expect(
      manager.listRepoFiles({
        repoEvent,
        repoKey: "owner/repo",
        branch: "main",
        path: "src",
      })
    ).rejects.toBeInstanceOf(RepositorySnapshotUnavailableError);
    expect(listDirectory).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ commitHash: firstSnapshot })
    );
  });
});
