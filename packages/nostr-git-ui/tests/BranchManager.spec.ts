import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/utils/grasp-url", () => ({
  isGraspRepoHttpUrl: () => false,
}));

vi.mock("$lib/stores/context", () => ({
  context: {
    remove: () => undefined,
    loading: () => "loading-id",
  },
}));

vi.mock("$lib/stores/toast", () => ({
  toast: {
    push: () => undefined,
  },
}));

import { BranchManager } from "../src/lib/components/git/BranchManager";

describe("BranchManager", () => {
  it("augments a partial state-derived branch list with vendor refs", async () => {
    const workerManager = {} as any;
    const vendorReadRouter = {
      listRefs: vi.fn(async () => ({
        refs: [
          { name: "dev", type: "heads", fullRef: "refs/heads/dev", commitId: "dev-oid" },
          { name: "main", type: "heads", fullRef: "refs/heads/main", commitId: "main-oid" },
          {
            name: "release/1.0",
            type: "heads",
            fullRef: "refs/heads/release/1.0",
            commitId: "release-oid",
          },
        ],
      })),
    } as any;

    const manager = new BranchManager(workerManager, undefined, { vendorReadRouter });
    manager.setRepoEvent({
      id: "repo-announcement",
      kind: 30617,
      pubkey: "owner",
      created_at: 1,
      tags: [
        ["d", "repo"],
        ["clone", "https://github.com/example/repo.git"],
      ],
      content: "",
      sig: "sig",
    } as any);

    await manager.loadAllRefs(async () => [
      { name: "dev", type: "heads", fullRef: "refs/heads/dev", commitId: "dev-oid" },
    ]);

    expect(vendorReadRouter.listRefs).toHaveBeenCalledTimes(1);
    expect(manager.getBranches().map((branch) => branch.name)).toEqual([
      "dev",
      "main",
      "release/1.0",
    ]);
  });
});
