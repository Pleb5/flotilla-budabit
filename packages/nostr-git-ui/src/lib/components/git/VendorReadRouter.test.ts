import { afterEach, describe, expect, it, vi } from "vitest";

import { VendorReadRouter, type RefDiscoverySource } from "./VendorReadRouter";
import { GitNaturalReadError } from "@nostr-git/core/git";
import { clearUrlPreferenceCache } from "@nostr-git/core/utils";

afterEach(() => {
  vi.restoreAllMocks();
  clearUrlPreferenceCache();
});

const gitNaturalSource = (
  operation: "listRefs" | "listDirectory" | "getFileContent" | "listCommits",
  remoteUrl: string,
  overrides: Record<string, unknown> = {}
) => ({
  kind: "git-natural" as const,
  label: "Git natural Smart HTTP",
  operation,
  remoteUrl,
  effectiveUrl: `${remoteUrl}/info/refs?service=git-upload-pack`,
  usesProxy: false,
  attemptedUrls: [remoteUrl],
  elapsedMs: 1,
  ...overrides,
});

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));
const graspUrl =
  "https://gitnostr.com/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/repo.git";
const hostedVendorUrls = [
  "https://github.com/example/repo.git",
  "https://gitlab.com/example/repo.git",
  "https://gitea.com/example/repo.git",
];

describe("VendorReadRouter.listRefs", () => {
  it("rejects direct calls to emitted Bitbucket methods before token or network access", async () => {
    const getTokens = vi.fn(async () => [{ host: "bitbucket.org", token: "retained" }]);
    const router = new VendorReadRouter({ getTokens });
    const remoteUrl = "https://bitbucket.org/example/repo.git";

    await expect(
      (router as any).vendorListDirectoryBitbucket({
        vendor: "bitbucket",
        remoteUrl,
        branch: "main",
        path: "",
      })
    ).rejects.toThrow(/Bitbucket provider is disabled/i);
    await expect(
      (router as any).vendorGetFileContentBitbucket({
        vendor: "bitbucket",
        remoteUrl,
        branch: "main",
        path: "README.md",
      })
    ).rejects.toThrow(/Bitbucket provider is disabled/i);
    await expect((router as any).vendorListRefsBitbucket(remoteUrl)).rejects.toThrow(
      /Bitbucket provider is disabled/i
    );
    await expect(
      (router as any).vendorListCommitsBitbucket({ remoteUrl, branch: "main" })
    ).rejects.toThrow(/Bitbucket provider is disabled/i);
    expect(getTokens).not.toHaveBeenCalled();
  });

  it("does not attempt reads for disabled Bitbucket remotes", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [{ host: "bitbucket.org", token: "retained" }],
      preferVendorReads: true,
      gitNaturalReads: "enabled",
      gitNaturalReadPolicy: "all-http",
    });
    const vendorSpy = vi.spyOn(router as any, "vendorListRefs");
    const workerManager = {
      gitNaturalListRefs: vi.fn(),
      listServerRefs: vi.fn(),
      listBranchesFromEvent: vi.fn(async () => []),
    } as any;

    const result = await router.listRefs({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      cloneUrls: ["https://bitbucket.org/example/repo.git"],
    });

    expect(result.source.kind).toBe("local");
    expect(workerManager.gitNaturalListRefs).not.toHaveBeenCalled();
    expect(workerManager.listServerRefs).not.toHaveBeenCalled();
    expect(vendorSpy).not.toHaveBeenCalled();
  });

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
    expect(result.source).toEqual(
      expect.objectContaining({
        operation: "listRefs",
        remoteUrl: "https://example.com/owner/repo.git",
        attemptedUrls: ["https://example.com/owner/repo.git"],
        elapsedMs: expect.any(Number),
      })
    );
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

    expect(result.source.kind).toBe("provider-rest");
    expect(result.source.operation).toBe("listRefs");
    expect(result.defaultBranch).toBe("master");
    expect(result.source.defaultBranch).toBe("master");
    expect(result.refs.map((ref) => ref.name)).toEqual(["dev", "master"]);
    expect(workerManager.listServerRefs).not.toHaveBeenCalled();
  });

  it("uses Git natural before provider REST when enabled", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
      gitNaturalReads: "enabled",
    });
    const vendorSpy = vi.spyOn(router as any, "vendorListRefs").mockResolvedValue({
      refs: [
        {
          name: "provider",
          type: "heads",
          fullRef: "refs/heads/provider",
          commitId: "999999",
        },
      ],
      defaultBranch: "provider",
    });

    const workerManager = {
      gitNaturalListRefs: vi.fn(async ({ url }: { url: string }) => ({
        refs: [
          { ref: "HEAD", oid: "111111", target: "refs/heads/main" },
          { ref: "refs/heads/main", oid: "111111" },
        ],
        defaultBranch: "main",
        source: gitNaturalSource("listRefs", url, { defaultBranch: "main", ref: "main" }),
      })),
      listServerRefs: vi.fn(async () => []),
      listBranchesFromEvent: vi.fn(async () => []),
    } as any;

    const result = await router.listRefs({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      cloneUrls: ["https://github.com/example/repo.git"],
    });

    expect(result.source.kind).toBe("git-natural");
    expect(result.fromVendor).toBe(false);
    expect(result.defaultBranch).toBe("main");
    expect(result.refs.map((ref) => ref.name)).toEqual(["main"]);
    expect(workerManager.gitNaturalListRefs).toHaveBeenCalledTimes(1);
    expect(vendorSpy).not.toHaveBeenCalled();
    expect(workerManager.listServerRefs).not.toHaveBeenCalled();
  });

  it("keeps provider REST output unchanged in Git natural shadow mode", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
      gitNaturalReads: "shadow",
    });
    vi.spyOn(router as any, "vendorListRefs").mockResolvedValue({
      refs: [
        {
          name: "provider",
          type: "heads",
          fullRef: "refs/heads/provider",
          commitId: "222222",
        },
      ],
      defaultBranch: "provider",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const workerManager = {
      gitNaturalListRefs: vi.fn(async ({ url }: { url: string }) => ({
        refs: [
          { ref: "HEAD", oid: "111111", target: "refs/heads/main" },
          { ref: "refs/heads/main", oid: "111111" },
        ],
        defaultBranch: "main",
        source: gitNaturalSource("listRefs", url, { defaultBranch: "main", ref: "main" }),
      })),
      listServerRefs: vi.fn(async () => []),
      listBranchesFromEvent: vi.fn(async () => []),
    } as any;

    const result = await router.listRefs({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      cloneUrls: ["https://github.com/example/repo.git"],
    });

    expect(result.source.kind).toBe("provider-rest");
    expect(result.fromVendor).toBe(true);
    expect(result.defaultBranch).toBe("provider");
    expect(result.refs.map((ref) => ref.name)).toEqual(["provider"]);
    expect(workerManager.gitNaturalListRefs).toHaveBeenCalledTimes(1);

    await nextTick();
    expect(warnSpy).toHaveBeenCalledWith(
      "[VendorReadRouter] Git natural shadow mismatch",
      expect.objectContaining({
        operation: "listRefs",
        remoteUrl: "https://github.com/example/repo.git",
        ref: "provider",
        baselineSource: expect.objectContaining({ kind: "provider-rest" }),
        naturalSource: expect.objectContaining({ kind: "git-natural" }),
      })
    );
  });

  it("does not promote a secondary vendor URL ahead of the first remote", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
    });
    const vendorSpy = vi.spyOn(router as any, "vendorListRefs");

    const workerManager = {
      listServerRefs: vi.fn(async () => [
        { ref: "HEAD", oid: "head", target: "refs/heads/main" },
        { ref: "refs/heads/main", oid: "111111" },
      ]),
      listBranchesFromEvent: vi.fn(async () => []),
    } as any;

    const result = await router.listRefs({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      cloneUrls: ["https://example.com/owner/repo.git", "https://github.com/example/repo.git"],
    });

    expect(result.source.kind).toBe("git-remote");
    expect(result.source.remoteUrl).toBe("https://example.com/owner/repo.git");
    expect(vendorSpy).not.toHaveBeenCalled();
    expect(workerManager.listServerRefs).toHaveBeenCalledTimes(1);
  });

  it("reports vendor support only for the selected first remote", () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
    });

    expect(
      router.hasVendorSupport([
        "https://example.com/owner/repo.git",
        "https://github.com/example/repo.git",
      ])
    ).toBe(false);
    expect(
      router.hasVendorSupport([
        "https://gitnostr.com/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/repo.git",
      ])
    ).toBe(false);
    expect(router.hasVendorSupport(["https://github.com/example/repo.git"])).toBe(true);
  });

  it("accepts the planned git-natural source metadata shape", () => {
    const source: RefDiscoverySource = {
      kind: "git-natural",
      label: "Git natural",
      operation: "listDirectory",
      remoteUrl: "https://example.com/owner/repo.git",
      effectiveUrl: "https://example.com/owner/repo.git/info/refs?service=git-upload-pack",
      usesProxy: false,
      ref: "main",
      commitHash: "a".repeat(40),
      capability: "filter",
      fallbackReason: "missing-filter-capability",
      elapsedMs: 12,
    };

    expect(source.kind).toBe("git-natural");
    expect(source.operation).toBe("listDirectory");
  });
});

describe("VendorReadRouter natural read fallback", () => {
  it("does not use provider REST for an operational Git natural failure", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
      gitNaturalReads: "enabled",
    });
    const vendorSpy = vi.spyOn(router as any, "vendorListDirectory").mockResolvedValue({
      files: [{ path: "README.md", type: "file", oid: "222222" }],
      path: "",
      ref: "main",
      fromVendor: true,
    });

    const workerManager = {
      gitNaturalListDirectory: vi.fn(async () => {
        throw new Error("natural unavailable");
      }),
      listRepoFilesFromEvent: vi.fn(async () => []),
    } as any;

    await expect(
      router.listDirectory({
        workerManager,
        repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
        repoKey: "owner/repo",
        cloneUrls: ["https://github.com/example/repo.git"],
        branch: "main",
        path: "",
      })
    ).rejects.toThrow("Git natural listDirectory failed");

    expect(workerManager.gitNaturalListDirectory).toHaveBeenCalledTimes(1);
    expect(vendorSpy).not.toHaveBeenCalled();
    expect(workerManager.listRepoFilesFromEvent).not.toHaveBeenCalled();
  });

  it("does not use the worker clone for an operational Git natural file failure", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
      gitNaturalReads: "enabled",
    });
    vi.spyOn(router as any, "vendorGetFileContent").mockRejectedValue(new Error("REST failed"));

    const workerManager = {
      gitNaturalGetFileContent: vi.fn(async () => {
        throw new Error("natural unavailable");
      }),
      getRepoFileContentFromEvent: vi.fn(async () => "worker content"),
    } as any;

    await expect(
      router.getFileContent({
        workerManager,
        repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
        repoKey: "owner/repo",
        cloneUrls: ["https://github.com/example/repo.git"],
        branch: "main",
        path: "README.md",
      })
    ).rejects.toThrow("Git natural getFileContent failed");

    expect(workerManager.gitNaturalGetFileContent).toHaveBeenCalledTimes(1);
    expect(workerManager.getRepoFileContentFromEvent).not.toHaveBeenCalled();
  });

  it("advances to the next natural remote without invoking clone fallback", async () => {
    const router = new VendorReadRouter({ getTokens: async () => [] });
    const primary = "https://relay.example/repo.git";
    const secondary = "https://github.com/example/repo.git";
    const workerManager = {
      gitNaturalListDirectory: vi.fn(async ({ url }: { url: string }) => {
        if (url === primary) throw new Error("pack parser failed");
        return {
          path: "",
          ref: "refs/heads/main",
          entries: [{ name: "README.md", path: "README.md", type: "file" }],
          source: gitNaturalSource("listDirectory", url),
        };
      }),
      listRepoFilesFromEvent: vi.fn(),
    } as any;

    const result = await router.listDirectory({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      repoKey: "owner/repo",
      cloneUrls: [primary, secondary],
      branch: "main",
    });

    expect(result.source?.kind).toBe("git-natural");
    expect(result.source?.remoteUrl).toBe(secondary);
    expect(
      workerManager.gitNaturalListDirectory.mock.calls.map(([value]: any[]) => value.url)
    ).toEqual([primary, secondary]);
    expect(workerManager.listRepoFilesFromEvent).not.toHaveBeenCalled();
  });

  it("allows a URL-scoped clone only after explicit missing filter support", async () => {
    const router = new VendorReadRouter({ getTokens: async () => [], preferVendorReads: false });
    const remoteUrl = "https://example.com/owner/repo.git";
    const workerManager = {
      gitNaturalListDirectory: vi.fn(async () => {
        throw new GitNaturalReadError(
          "missing-filter-capability",
          "Git server does not advertise filter support",
          { remoteUrl, capability: "filter" }
        );
      }),
      listRepoFilesFromEvent: vi.fn(async () => [{ path: "README.md", type: "file" }]),
    } as any;

    const result = await router.listDirectory({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      repoKey: "owner/repo",
      cloneUrls: [remoteUrl],
      branch: "main",
    });

    expect(result.source?.kind).toBe("worker-clone");
    expect(workerManager.listRepoFilesFromEvent).toHaveBeenCalledWith(
      expect.objectContaining({ cloneUrls: [remoteUrl] })
    );
  });

  it("advances naturally after a same-URL missing-filter clone fallback fails", async () => {
    const router = new VendorReadRouter({ getTokens: async () => [], preferVendorReads: false });
    const primary = "https://primary.example/repo.git";
    const secondary = "https://secondary.example/repo.git";
    const callOrder: string[] = [];
    const workerManager = {
      gitNaturalListDirectory: vi.fn(async ({ url }: { url: string }) => {
        callOrder.push(`natural:${url}`);
        if (url === primary) {
          throw new GitNaturalReadError(
            "missing-filter-capability",
            "Git server does not advertise filter support",
            { remoteUrl: url, capability: "filter" }
          );
        }
        return {
          path: "",
          ref: "refs/heads/main",
          entries: [{ name: "README.md", path: "README.md", type: "file" }],
          source: gitNaturalSource("listDirectory", url),
        };
      }),
      listRepoFilesFromEvent: vi.fn(async ({ cloneUrls }: { cloneUrls: string[] }) => {
        callOrder.push(`clone:${cloneUrls[0]}`);
        throw new Error("clone failed");
      }),
    } as any;

    const result = await router.listDirectory({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      repoKey: "owner/repo",
      cloneUrls: [primary, secondary],
      branch: "main",
    });

    expect(callOrder).toEqual([`natural:${primary}`, `clone:${primary}`, `natural:${secondary}`]);
    expect(result.source?.kind).toBe("git-natural");
    expect(result.source?.remoteUrl).toBe(secondary);
  });

  it("reuses a successful fallback across repository read features", async () => {
    const router = new VendorReadRouter({ getTokens: async () => [] });
    const primary = "https://primary.example/repo.git";
    const secondary = "https://secondary.example/repo.git";
    const workerManager = {
      gitNaturalListDirectory: vi.fn(async ({ url }: { url: string }) => {
        if (url === primary) throw new Error("primary unavailable");
        return {
          path: "",
          ref: "refs/heads/main",
          entries: [],
          source: gitNaturalSource("listDirectory", url),
        };
      }),
      gitNaturalGetFileContent: vi.fn(async ({ url }: { url: string }) => ({
        path: "README.md",
        ref: "refs/heads/main",
        content: "SGVsbG8=",
        encoding: "base64",
        size: 5,
        source: gitNaturalSource("getFileContent", url),
      })),
      listRepoFilesFromEvent: vi.fn(),
      getRepoFileContentFromEvent: vi.fn(),
    } as any;
    const common = {
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      repoKey: "owner/repo",
      cloneUrls: [primary, secondary],
      branch: "main",
    };

    await router.listDirectory(common);
    await router.getFileContent({ ...common, path: "README.md" });

    expect(workerManager.gitNaturalGetFileContent).toHaveBeenCalledTimes(1);
    expect(workerManager.gitNaturalGetFileContent).toHaveBeenCalledWith(
      expect.objectContaining({ url: secondary })
    );
    expect(workerManager.getRepoFileContentFromEvent).not.toHaveBeenCalled();
  });
});

describe("VendorReadRouter GRASP and generic natural rollout", () => {
  it("uses Git natural for GRASP browsing operations without clone-state calls", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
      gitNaturalReads: "enabled",
      gitNaturalReadPolicy: "grasp-and-generic",
    });
    const commitHash = "a".repeat(40);
    const treeHash = "b".repeat(40);
    const blobHash = "c".repeat(40);

    const workerManager = {
      gitNaturalListRefs: vi.fn(
        async ({ url, corsProxy }: { url: string; corsProxy?: string }) => ({
          refs: [
            { ref: "HEAD", oid: commitHash, target: "refs/heads/main" },
            { ref: "refs/heads/main", oid: commitHash },
          ],
          defaultBranch: "main",
          source: gitNaturalSource("listRefs", url, {
            defaultBranch: "main",
            ref: "main",
            usesProxy: Boolean(corsProxy),
          }),
        })
      ),
      gitNaturalListDirectory: vi.fn(async ({ url }: { url: string }) => ({
        path: "",
        ref: "refs/heads/main",
        commitHash,
        treeHash,
        entries: [
          { name: "README.md", path: "README.md", type: "file", mode: "100644", oid: blobHash },
        ],
        source: gitNaturalSource("listDirectory", url, {
          ref: "refs/heads/main",
          commitHash,
          objectHash: treeHash,
          capability: "filter=blob:none",
        }),
      })),
      gitNaturalGetFileContent: vi.fn(async ({ url }: { url: string }) => ({
        path: "README.md",
        ref: "refs/heads/main",
        commitHash,
        objectHash: blobHash,
        content: "SGVsbG8=",
        encoding: "base64",
        size: 5,
        source: gitNaturalSource("getFileContent", url, {
          ref: "refs/heads/main",
          commitHash,
          objectHash: blobHash,
          capability: "object-by-hash",
        }),
      })),
      gitNaturalListCommits: vi.fn(async ({ url }: { url: string }) => ({
        ref: "refs/heads/main",
        commitHash,
        commits: [
          {
            hash: commitHash,
            tree: treeHash,
            parents: [],
            author: { name: "Alice", email: "alice@example.com", timestamp: 1, timezone: "+0000" },
            committer: {
              name: "Alice",
              email: "alice@example.com",
              timestamp: 1,
              timezone: "+0000",
            },
            message: "Initial commit",
          },
        ],
        source: gitNaturalSource("listCommits", url, {
          ref: "refs/heads/main",
          commitHash,
          capability: "filter=tree:0",
        }),
      })),
      listServerRefs: vi.fn(async () => []),
      listBranchesFromEvent: vi.fn(async () => []),
      listRepoFilesFromEvent: vi.fn(async () => []),
      getRepoFileContentFromEvent: vi.fn(async () => "worker content"),
      getCommitHistory: vi.fn(async () => ({ success: true, commits: [] })),
      initializeRepo: vi.fn(),
      smartInitializeRepo: vi.fn(),
      ensureShallowClone: vi.fn(),
      ensureFullClone: vi.fn(),
    } as any;
    const repoEvent = { id: "repo", pubkey: "owner", tags: [] } as any;

    const refs = await router.listRefs({ workerManager, repoEvent, cloneUrls: [graspUrl] });
    const directory = await router.listDirectory({
      workerManager,
      repoEvent,
      repoKey: "owner/repo",
      cloneUrls: [graspUrl],
      branch: "main",
      path: "",
    });
    const file = await router.getFileContent({
      workerManager,
      repoEvent,
      repoKey: "owner/repo",
      cloneUrls: [graspUrl],
      branch: "main",
      path: "README.md",
    });
    const commits = await router.listCommits({
      workerManager,
      repoEvent,
      repoKey: "owner/repo",
      cloneUrls: [graspUrl],
      branch: "main",
      depth: 10,
    });

    expect(refs.source.kind).toBe("git-natural");
    expect(directory.source?.kind).toBe("git-natural");
    expect(file.source?.kind).toBe("git-natural");
    expect(file.content).toBe("SGVsbG8=");
    expect(file.encoding).toBe("base64");
    expect(file.size).toBe(5);
    expect(commits.source?.kind).toBe("git-natural");
    expect(workerManager.gitNaturalListRefs).toHaveBeenCalledWith(
      expect.objectContaining({ url: graspUrl, enabled: true })
    );
    expect(workerManager.gitNaturalListRefs.mock.calls[0][0]).not.toHaveProperty("corsProxy");
    expect(workerManager.listServerRefs).not.toHaveBeenCalled();
    expect(workerManager.listRepoFilesFromEvent).not.toHaveBeenCalled();
    expect(workerManager.getRepoFileContentFromEvent).not.toHaveBeenCalled();
    expect(workerManager.getCommitHistory).not.toHaveBeenCalled();
    expect(workerManager.initializeRepo).not.toHaveBeenCalled();
    expect(workerManager.smartInitializeRepo).not.toHaveBeenCalled();
    expect(workerManager.ensureShallowClone).not.toHaveBeenCalled();
    expect(workerManager.ensureFullClone).not.toHaveBeenCalled();
  });

  it("preserves Git natural file bytes as base64 with byte size", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: false,
      gitNaturalReads: "enabled",
    });
    const remoteUrl = "https://example.com/owner/repo.git";
    const workerManager = {
      gitNaturalGetFileContent: vi.fn(async ({ url }: { url: string }) => ({
        path: "image.bin",
        ref: "refs/heads/main",
        commitHash: "a".repeat(40),
        objectHash: "b".repeat(40),
        content: "AP8Q",
        encoding: "base64",
        size: 3,
        source: gitNaturalSource("getFileContent", url, {
          ref: "refs/heads/main",
          commitHash: "a".repeat(40),
          objectHash: "b".repeat(40),
          capability: "object-by-hash",
        }),
      })),
      getRepoFileContentFromEvent: vi.fn(async () => "worker content"),
    } as any;

    const result = await router.getFileContent({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      repoKey: "owner/repo",
      cloneUrls: [remoteUrl],
      branch: "main",
      path: "image.bin",
    });

    expect(result.source?.kind).toBe("git-natural");
    expect(result.content).toBe("AP8Q");
    expect(result.encoding).toBe("base64");
    expect(result.size).toBe(3);
    expect(workerManager.getRepoFileContentFromEvent).not.toHaveBeenCalled();
  });

  it("passes an explicit null Git natural CORS proxy override", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
      gitNaturalReads: "enabled",
      gitNaturalCorsProxy: null,
    });
    const remoteUrl = "https://example.com/owner/repo.git";
    const workerManager = {
      gitNaturalListRefs: vi.fn(async ({ url }: { url: string; corsProxy: null }) => ({
        refs: [
          { ref: "HEAD", oid: "a".repeat(40), target: "refs/heads/main" },
          { ref: "refs/heads/main", oid: "a".repeat(40) },
        ],
        defaultBranch: "main",
        source: gitNaturalSource("listRefs", url, { defaultBranch: "main", ref: "main" }),
      })),
      listServerRefs: vi.fn(async () => []),
      listBranchesFromEvent: vi.fn(async () => []),
    } as any;

    await router.listRefs({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      cloneUrls: [remoteUrl],
    });

    expect(workerManager.gitNaturalListRefs).toHaveBeenCalledWith(
      expect.objectContaining({ url: remoteUrl, enabled: true, corsProxy: null })
    );
  });

  it("uses Git natural for generic HTTP remotes under the GRASP/generic policy", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
      gitNaturalReads: "enabled",
      gitNaturalReadPolicy: "grasp-and-generic",
    });
    const workerManager = {
      gitNaturalListDirectory: vi.fn(async ({ url }: { url: string }) => ({
        path: "src",
        ref: "refs/heads/main",
        commitHash: "a".repeat(40),
        treeHash: "b".repeat(40),
        entries: [
          {
            name: "index.ts",
            path: "src/index.ts",
            type: "file",
            mode: "100644",
            oid: "c".repeat(40),
          },
        ],
        source: gitNaturalSource("listDirectory", url, {
          ref: "refs/heads/main",
          commitHash: "a".repeat(40),
          objectHash: "b".repeat(40),
          capability: "filter=blob:none",
        }),
      })),
      listRepoFilesFromEvent: vi.fn(async () => []),
    } as any;

    const result = await router.listDirectory({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      repoKey: "owner/repo",
      cloneUrls: ["https://example.com/owner/repo.git"],
      branch: "main",
      path: "src",
    });

    expect(result.source?.kind).toBe("git-natural");
    expect(result.files.map((file) => file.path)).toEqual(["src/index.ts"]);
    expect(workerManager.listRepoFilesFromEvent).not.toHaveBeenCalled();
  });

  it("keeps hosted provider REST first under the GRASP/generic policy", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
      gitNaturalReads: "enabled",
      gitNaturalReadPolicy: "grasp-and-generic",
    });
    vi.spyOn(router as any, "vendorListRefs").mockResolvedValue({
      refs: [{ name: "main", type: "heads", fullRef: "refs/heads/main", commitId: "111111" }],
      defaultBranch: "main",
    });
    const workerManager = {
      gitNaturalListRefs: vi.fn(async () => ({ refs: [] })),
      listServerRefs: vi.fn(async () => []),
      listBranchesFromEvent: vi.fn(async () => []),
    } as any;

    const result = await router.listRefs({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      cloneUrls: ["https://github.com/example/repo.git"],
    });

    expect(result.source.kind).toBe("provider-rest");
    expect(workerManager.gitNaturalListRefs).not.toHaveBeenCalled();
  });

  it("adds Git natural failure context when the worker clone fallback also fails", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
      gitNaturalReads: "enabled",
      gitNaturalReadPolicy: "grasp-and-generic",
    });
    const reportCloneUrlError = vi.fn();
    router.setCloneUrlErrorCallback(reportCloneUrlError);
    const workerManager = {
      gitNaturalGetFileContent: vi.fn(async () => {
        throw new GitNaturalReadError("missing-filter-capability", "missing filter capability");
      }),
      getRepoFileContentFromEvent: vi.fn(async () => {
        throw new Error("clone initialization failed");
      }),
    } as any;

    await expect(
      router.getFileContent({
        workerManager,
        repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
        repoKey: "owner/repo",
        cloneUrls: ["https://example.com/owner/repo.git"],
        branch: "main",
        path: "README.md",
      })
    ).rejects.toThrow("Git natural getFileContent failed for all eligible remotes");

    expect(reportCloneUrlError).toHaveBeenCalledWith(
      "https://example.com/owner/repo.git",
      expect.stringContaining("Git natural read failed"),
      undefined
    );
  });
});

describe("VendorReadRouter hosted provider natural rollout", () => {
  it("uses Git natural before hosted provider REST under the all-http policy", async () => {
    for (const cloneUrl of hostedVendorUrls) {
      const router = new VendorReadRouter({
        getTokens: async () => [],
        preferVendorReads: true,
        gitNaturalReads: "enabled",
        gitNaturalReadPolicy: "all-http",
      });
      const vendorSpy = vi.spyOn(router as any, "vendorListRefs").mockResolvedValue({
        refs: [
          { name: "provider", type: "heads", fullRef: "refs/heads/provider", commitId: "999999" },
        ],
        defaultBranch: "provider",
      });
      const workerManager = {
        gitNaturalListRefs: vi.fn(async ({ url }: { url: string }) => ({
          refs: [
            { ref: "HEAD", oid: "1".repeat(40), target: "refs/heads/main" },
            { ref: "refs/heads/main", oid: "1".repeat(40) },
          ],
          defaultBranch: "main",
          source: gitNaturalSource("listRefs", url, { defaultBranch: "main", ref: "main" }),
        })),
        listServerRefs: vi.fn(async () => []),
        listBranchesFromEvent: vi.fn(async () => []),
      } as any;

      const result = await router.listRefs({
        workerManager,
        repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
        cloneUrls: [cloneUrl],
      });

      expect(result.source.kind).toBe("git-natural");
      expect(result.defaultBranch).toBe("main");
      expect(workerManager.gitNaturalListRefs).toHaveBeenCalledWith(
        expect.objectContaining({ url: cloneUrl, enabled: true })
      );
      expect(vendorSpy).not.toHaveBeenCalled();
      expect(workerManager.listServerRefs).not.toHaveBeenCalled();
    }
  });

  it("falls back to hosted provider REST only for missing filter support", async () => {
    const fallbackSafeFailures = [
      new GitNaturalReadError(
        "missing-filter-capability",
        "Git server missing required capability: filter"
      ),
    ];

    for (const naturalError of fallbackSafeFailures) {
      const router = new VendorReadRouter({
        getTokens: async () => [],
        preferVendorReads: true,
        gitNaturalReads: "enabled",
        gitNaturalReadPolicy: "all-http",
      });
      const vendorSpy = vi.spyOn(router as any, "vendorListDirectory").mockResolvedValue({
        files: [{ path: "README.md", type: "file", oid: "2".repeat(40) }],
        path: "",
        ref: "main",
        fromVendor: true,
      });
      const workerManager = {
        gitNaturalListDirectory: vi.fn(async () => {
          throw naturalError;
        }),
        listRepoFilesFromEvent: vi.fn(async () => []),
      } as any;

      const result = await router.listDirectory({
        workerManager,
        repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
        repoKey: "owner/repo",
        cloneUrls: ["https://github.com/example/repo.git"],
        branch: "main",
        path: "",
      });

      expect(result.source?.kind).toBe("provider-rest");
      expect(result.source?.fallbackReason).toBe("missing-filter-capability");
      expect(vendorSpy).toHaveBeenCalledTimes(1);
      expect(workerManager.gitNaturalListDirectory.mock.invocationCallOrder[0]).toBeLessThan(
        vendorSpy.mock.invocationCallOrder[0]
      );
      expect(workerManager.listRepoFilesFromEvent).not.toHaveBeenCalled();
    }
  });
});

describe("VendorReadRouter.listCommits", () => {
  it("does not initialize a clone after an operational natural failure", async () => {
    const router = new VendorReadRouter({ getTokens: async () => [] });
    const workerManager = {
      gitNaturalListCommits: vi.fn(async () => {
        throw new Error("pack parser failed");
      }),
      ensureFullClone: vi.fn(),
      getCommitHistory: vi.fn(),
    } as any;

    await expect(
      router.listCommits({
        workerManager,
        repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
        repoKey: "owner/repo",
        cloneUrls: ["https://example.com/repo.git"],
        branch: "main",
      })
    ).rejects.toThrow("Git natural listCommits failed");

    expect(workerManager.ensureFullClone).not.toHaveBeenCalled();
    expect(workerManager.getCommitHistory).not.toHaveBeenCalled();
  });

  it("uses Git natural commits before provider REST when enabled", async () => {
    const router = new VendorReadRouter({
      getTokens: async () => [],
      preferVendorReads: true,
      gitNaturalReads: "enabled",
    });
    const vendorSpy = vi.spyOn(router as any, "vendorListCommits").mockResolvedValue({
      commits: [],
      ref: "main",
      fromVendor: true,
      hasMore: false,
    });
    const commitHash = "a".repeat(40);

    const workerManager = {
      gitNaturalListCommits: vi.fn(async ({ url }: { url: string }) => ({
        ref: "refs/heads/main",
        commitHash,
        commits: [
          {
            hash: commitHash,
            tree: "b".repeat(40),
            parents: [],
            author: {
              name: "Alice",
              email: "alice@example.com",
              timestamp: 1,
              timezone: "+0000",
            },
            committer: {
              name: "Alice",
              email: "alice@example.com",
              timestamp: 1,
              timezone: "+0000",
            },
            message: "Initial commit",
          },
        ],
        source: gitNaturalSource("listCommits", url, {
          ref: "refs/heads/main",
          commitHash,
          capability: "filter=tree:0",
        }),
      })),
      getCommitHistory: vi.fn(async () => ({ success: true, commits: [] })),
    } as any;

    const result = await router.listCommits({
      workerManager,
      repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
      repoKey: "owner/repo",
      cloneUrls: ["https://github.com/example/repo.git"],
      branch: "main",
      depth: 10,
    });

    expect(result.source?.kind).toBe("git-natural");
    expect(result.fromVendor).toBe(false);
    expect(result.ref).toBe("main");
    expect(result.commits.map((commit) => commit.sha)).toEqual([commitHash]);
    expect(workerManager.gitNaturalListCommits).toHaveBeenCalledTimes(1);
    expect(vendorSpy).not.toHaveBeenCalled();
    expect(workerManager.getCommitHistory).not.toHaveBeenCalled();
  });

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

    await expect(
      router.listCommits({
        workerManager,
        repoEvent: { id: "repo", pubkey: "owner", tags: [] } as any,
        repoKey: "owner/repo",
        cloneUrls: ["https://github.com/example/repo.git"],
        branch: "master",
      })
    ).rejects.toThrow("Branch not found");

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
