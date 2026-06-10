import { beforeEach, describe, expect, it, vi } from "vitest";

import { BranchManager } from "./BranchManager";

vi.mock("$lib/stores/context", () => ({
  context: {
    loading: vi.fn(() => null),
    remove: vi.fn(),
    update: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("$lib/stores/toast", () => ({
  toast: {
    push: vi.fn(),
  },
}));

describe("BranchManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not treat the selected branch as the default branch", () => {
    const manager = new BranchManager({} as any);

    manager.setSelectedBranch("main");

    expect(manager.getMainBranch()).toBe("master");
    expect(manager.getSelectedBranch()).toBe("main");
  });

  it("replaces optimistic stale heads with discovered refs", async () => {
    const vendorReadRouter = {
      listRefs: vi.fn(async () => ({
        refs: [
          {
            name: "add-logos",
            type: "heads",
            fullRef: "refs/heads/add-logos",
            commitId: "abc123",
          },
          {
            name: "ci/nostr-release",
            type: "heads",
            fullRef: "refs/heads/ci/nostr-release",
            commitId: "def456",
          },
        ],
        fromVendor: false,
        source: {
          kind: "git-remote",
          label: "Git remote",
          remoteUrl: "https://relay.example/repo.git",
        },
      })),
    };

    const manager = new BranchManager({} as any, undefined, {
      vendorReadRouter: vendorReadRouter as any,
    });

    manager.setRepoEvent({
      id: "repo-event",
      pubkey: "owner",
      kind: 30617,
      created_at: 1,
      content: "",
      sig: "sig",
      tags: [["d", "repo"]],
    } as any);

    manager.processRepoStateEvent({
      id: "state-event",
      pubkey: "owner",
      kind: 30618,
      created_at: 1,
      content: "",
      sig: "sig",
      tags: [
        ["HEAD", "ref: refs/heads/maint"],
        ["refs/heads/maint", "111111"],
        ["refs/heads/openwrt-apk", "222222"],
      ],
    } as any);

    manager.setSelectedBranch("maint");

    await manager.loadAllRefs(async () => [
      {
        name: "maint",
        type: "heads",
        fullRef: "refs/heads/maint",
        commitId: "111111",
      },
      {
        name: "openwrt-apk",
        type: "heads",
        fullRef: "refs/heads/openwrt-apk",
        commitId: "222222",
      },
    ]);

    expect(manager.getAllRefs().map((ref) => ref.name)).toEqual(["add-logos", "ci/nostr-release"]);
    expect(manager.getMainBranch()).toBe("add-logos");
    expect(manager.getSelectedBranch()).toBe("add-logos");
    expect(manager.getRefDiscoverySource()?.kind).toBe("git-remote");
  });

  it("uses the discovered remote default when repo-state HEAD is stale but still present", async () => {
    const vendorReadRouter = {
      listRefs: vi.fn(async () => ({
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
        fromVendor: true,
        source: {
          kind: "provider-rest",
          label: "Provider REST API",
          remoteUrl: "https://github.com/example/repo.git",
          defaultBranch: "master",
        },
      })),
    };

    const manager = new BranchManager({} as any, undefined, {
      vendorReadRouter: vendorReadRouter as any,
    });

    const repoEvent = {
      id: "repo-event",
      pubkey: "owner",
      kind: 30617,
      created_at: 1,
      content: "",
      sig: "sig",
      tags: [
        ["d", "repo"],
        ["clone", "https://github.com/example/repo.git"],
      ],
    } as any;

    manager.setRepoEvent(repoEvent);
    await manager.processRepoStateEventVerified(
      {
        id: "state-event",
        pubkey: "owner",
        kind: 30618,
        created_at: 1,
        content: "",
        sig: "sig",
        tags: [
          ["HEAD", "ref: refs/heads/dev"],
          ["refs/heads/dev", "111111"],
          ["refs/heads/master", "222222"],
        ],
      } as any,
      repoEvent
    );

    await manager.loadAllRefs(async () => [
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
    ]);

    expect(manager.getAllRefs().map((ref) => ref.name)).toEqual(["dev", "master"]);
    expect(manager.getMainBranch()).toBe("master");
    expect(manager.getSelectedBranch()).toBe("master");
    expect(manager.getRefDiscoverySource()?.defaultBranch).toBe("master");
  });

  it("filters peeled tags from repo-state refs", async () => {
    const manager = new BranchManager({} as any);

    manager.processRepoStateEvent({
      id: "state-event",
      pubkey: "owner",
      kind: 30618,
      created_at: 1,
      content: "",
      sig: "sig",
      tags: [
        ["HEAD", "ref: refs/heads/add-logos"],
        ["refs/heads/add-logos", "111111"],
        ["refs/tags/v0.2.0", "222222"],
        ["refs/tags/v0.2.0^{}", "333333"],
      ],
    } as any);

    await manager.loadAllRefs(async () => [
      {
        name: "add-logos",
        type: "heads",
        fullRef: "refs/heads/add-logos",
        commitId: "111111",
      },
      {
        name: "v0.2.0",
        type: "tags",
        fullRef: "refs/tags/v0.2.0",
        commitId: "222222",
      },
      {
        name: "v0.2.0^{}",
        type: "tags",
        fullRef: "refs/tags/v0.2.0^{}",
        commitId: "333333",
      },
    ]);

    expect(manager.getAllRefs().map((ref) => ref.name)).toEqual(["add-logos", "v0.2.0"]);
  });

  it("reports repo-state snapshot when no remote discovery is available", async () => {
    const manager = new BranchManager({} as any);

    await manager.loadAllRefs(async () => [
      {
        name: "maint",
        type: "heads",
        fullRef: "refs/heads/maint",
        commitId: "111111",
      },
    ]);

    expect(manager.getRefDiscoverySource()?.kind).toBe("repo-state");
  });

  it("waits for an in-flight ref load instead of returning stale refs", async () => {
    const manager = new BranchManager({} as any);
    let releaseLoad!: () => void;
    const callback = vi.fn(
      () =>
        new Promise<Array<{ name: string; type: "heads"; fullRef: string; commitId: string }>>(
          (resolve) => {
            releaseLoad = () =>
              resolve([
                {
                  name: "main",
                  type: "heads",
                  fullRef: "refs/heads/main",
                  commitId: "abc123",
                },
              ]);
          }
        )
    );

    const firstLoad = manager.loadAllRefs(callback);
    const secondLoad = manager.loadAllRefs(async () => {
      throw new Error("second callback should wait for the first load");
    });

    expect(manager.getAllRefs()).toEqual([]);
    releaseLoad();
    await Promise.all([firstLoad, secondLoad]);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(manager.getAllRefs().map((ref) => ref.name)).toEqual(["main"]);
  });
});
