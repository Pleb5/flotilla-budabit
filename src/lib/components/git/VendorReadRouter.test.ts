import { describe, expect, it, vi } from "vitest";

import { VendorReadRouter } from "./VendorReadRouter";

describe("VendorReadRouter.listRefs", () => {
  it("uses advertised git refs for non-vendor remotes", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
    });

    const workerManager = {
      listServerRefs: vi.fn(async () => [
        { ref: "HEAD", oid: "head", target: "refs/heads/openwrt-packaging" },
        { ref: "refs/heads/add-logos", oid: "111111" },
        { ref: "refs/heads/openwrt-packaging", oid: "222222" },
        { ref: "refs/tags/v0.2.0", oid: "333333" },
        { ref: "refs/tags/v0.2.0^{}", oid: "444444" },
      ]),
      listBranchesFromEvent: vi.fn(async () => []),
    } as any;

    const result = await router.listRefs({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      cloneUrls: ["https://example.com/owner/repo.git"],
    });

    expect(result.source.kind).toBe("git-remote");
    expect(result.defaultBranch).toBe("openwrt-packaging");
    expect(result.source.defaultBranch).toBe("openwrt-packaging");
    expect(result.refs.map((ref) => ref.name)).toEqual([
      "add-logos",
      "openwrt-packaging",
      "v0.2.0",
    ]);
    expect(workerManager.listServerRefs).toHaveBeenCalledTimes(1);
    expect(workerManager.listBranchesFromEvent).not.toHaveBeenCalled();
  });

  it("skips vendor REST reads for GRASP clone URLs and uses git refs directly", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const workerManager = {
      listServerRefs: vi.fn(async () => [
        { ref: "HEAD", oid: "head" },
        { ref: "refs/heads/main", oid: "111111" },
      ]),
      listBranchesFromEvent: vi.fn(async () => []),
    } as any;

    const result = await router.listRefs({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      cloneUrls: [
        "https://gitnostr.com/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/repo.git",
      ],
    });

    expect(result.source.kind).toBe("git-remote");
    expect(workerManager.listServerRefs).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("propagates vendor default branch metadata", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
    });

    vi.spyOn(router as any, "vendorListRefs").mockResolvedValue({
      refs: [
        {
          name: "dev",
          type: "heads",
          fullRef: "refs/heads/dev",
          commitId: "111111",
        },
        {
          name: "master",
          type: "heads",
          fullRef: "refs/heads/master",
          commitId: "222222",
        },
      ],
      defaultBranch: "master",
    });

    const workerManager = {
      listServerRefs: vi.fn(async () => []),
      listBranchesFromEvent: vi.fn(async () => []),
    } as any;

    const result = await router.listRefs({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      cloneUrls: ["https://github.com/example/repo.git"],
    });

    expect(result.source.kind).toBe("vendor");
    expect(result.defaultBranch).toBe("master");
    expect(result.source.defaultBranch).toBe("master");
    expect(result.refs.map((ref) => ref.name)).toEqual(["dev", "master"]);
    expect(workerManager.listServerRefs).not.toHaveBeenCalled();
  });
});

describe("VendorReadRouter.listCommits", () => {
  it("does not persist a branch-specific vendor 404 when git fallback succeeds", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
    });

    const reportCloneUrlError = vi.fn();
    router.setCloneUrlErrorCallback(reportCloneUrlError);

    vi.spyOn(router as any, "vendorListCommits").mockRejectedValue(
      new Error(
        "Not found (HTTP 404). (op=listCommits, remote=https://github.com/example/repo.git, branch=master)"
      )
    );

    const workerManager = {
      getCommitHistory: vi.fn(async () => ({
        success: true,
        commits: [
          {
            oid: "abc123",
            commit: {
              message: "Initial commit",
              author: { name: "Alice", email: "alice@example.com", timestamp: 1 },
              committer: { name: "Alice", email: "alice@example.com", timestamp: 1 },
              parent: [],
            },
          },
        ],
      })),
    } as any;

    const result = await router.listCommits({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      repoKey: "owner/repo",
      cloneUrls: ["https://github.com/example/repo.git"],
      branch: "master",
    });

    expect(result.fromVendor).toBe(false);
    expect(result.commits).toHaveLength(1);
    expect(reportCloneUrlError).not.toHaveBeenCalled();
  });

  it("records the vendor 404 when git fallback also fails", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
    });

    const reportCloneUrlError = vi.fn();
    router.setCloneUrlErrorCallback(reportCloneUrlError);

    vi.spyOn(router as any, "vendorListCommits").mockRejectedValue(
      new Error(
        "Not found (HTTP 404). (op=listCommits, remote=https://github.com/example/repo.git, branch=master)"
      )
    );

    const workerManager = {
      getCommitHistory: vi.fn(async () => ({
        success: false,
        error: "Branch not found",
      })),
    } as any;

    const result = await router.listCommits({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      repoKey: "owner/repo",
      cloneUrls: ["https://github.com/example/repo.git"],
      branch: "master",
    });

    expect(result.fromVendor).toBe(false);
    expect(result.commits).toHaveLength(0);
    expect(reportCloneUrlError).toHaveBeenCalledWith(
      "https://github.com/example/repo.git",
      expect.stringContaining("HTTP 404"),
      404
    );
  });

  it("treats GitHub empty-repo commits 409 as an empty history", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
    });

    const reportCloneUrlError = vi.fn();
    router.setCloneUrlErrorCallback(reportCloneUrlError);

    vi.spyOn(router as any, "vendorListCommits").mockRejectedValue(
      new Error(
        "Repository is empty (HTTP 409). (op=listCommits, remote=https://github.com/example/repo.git, branch=master)"
      )
    );

    const workerManager = {
      getCommitHistory: vi.fn(async () => ({
        success: false,
        error: "Could not find HEAD",
      })),
    } as any;

    const result = await router.listCommits({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      repoKey: "owner/repo",
      cloneUrls: ["https://github.com/example/repo.git"],
      branch: "master",
    });

    expect(result.fromVendor).toBe(false);
    expect(result.commits).toHaveLength(0);
    expect(reportCloneUrlError).not.toHaveBeenCalled();
  });
});
