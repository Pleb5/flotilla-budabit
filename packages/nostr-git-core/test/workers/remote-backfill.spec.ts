import {describe, expect, it, vi} from "vitest"

import {
  buildRemoteBackfillPlanFromSnapshots,
  executeRemoteBackfillUtil,
  type RemoteBackfillRemoteSnapshot,
} from "../../src/worker/workers/remote-backfill.js"

describe("worker/remote-backfill: buildRemoteBackfillPlanFromSnapshots", () => {
  it("plans safe creates and fast-forward updates from the effective branch tip", async () => {
    const snapshots: RemoteBackfillRemoteSnapshot[] = [
      {
        remoteUrl: "https://primary.example/repo.git",
        reachable: true,
        headBranch: "main",
        refs: [
          {ref: "refs/heads/main", name: "main", type: "heads", oid: "a".repeat(40)},
          {ref: "refs/heads/feature", name: "feature", type: "heads", oid: "f".repeat(40)},
          {ref: "refs/tags/v1.0.0", name: "v1.0.0", type: "tags", oid: "t".repeat(40)},
        ],
      },
      {
        remoteUrl: "https://secondary.example/repo.git",
        reachable: true,
        headBranch: "main",
        refs: [
          {ref: "refs/heads/main", name: "main", type: "heads", oid: "b".repeat(40)},
          {ref: "refs/tags/v1.0.0", name: "v1.0.0", type: "tags", oid: "t".repeat(40)},
        ],
      },
      {
        remoteUrl: "https://mirror.example/repo.git",
        reachable: true,
        headBranch: undefined,
        refs: [],
      },
    ]

    const plan = await buildRemoteBackfillPlanFromSnapshots(snapshots, {
      defaultBranch: "main",
      isDescendent: async (oid, ancestor) => oid === "b".repeat(40) && ancestor === "a".repeat(40),
    })

    expect(plan.summary.actionableRefCount).toBe(3)
    expect(plan.summary.readyRefCount).toBe(3)
    expect(plan.summary.conflictRefCount).toBe(0)

    const mainRef = plan.refs.find(ref => ref.ref === "refs/heads/main")
    expect(mainRef).toMatchObject({
      status: "ready",
      effectiveOid: "b".repeat(40),
      createCount: 1,
      fastForwardCount: 1,
      conflictCount: 0,
      selectedByDefault: true,
    })

    const featureRef = plan.refs.find(ref => ref.ref === "refs/heads/feature")
    expect(featureRef).toMatchObject({
      status: "ready",
      effectiveOid: "f".repeat(40),
      createCount: 2,
      fastForwardCount: 0,
      conflictCount: 0,
      selectedByDefault: false,
    })

    const releaseTag = plan.refs.find(ref => ref.ref === "refs/tags/v1.0.0")
    expect(releaseTag).toMatchObject({selectedByDefault: false})

    const mirrorPlan = plan.remotes.find(
      remote => remote.remoteUrl === "https://mirror.example/repo.git",
    )
    expect(mirrorPlan).toMatchObject({
      reachable: true,
      selectedByDefault: true,
      createCount: 3,
      fastForwardCount: 0,
      conflictCount: 0,
    })
    expect(mirrorPlan?.actions.map(action => `${action.action}:${action.ref}`)).toEqual([
      "create:refs/heads/feature",
      "create:refs/heads/main",
      "create:refs/tags/v1.0.0",
    ])
  })

  it("marks conflicting tags and divergent branches as manual-only", async () => {
    const snapshots: RemoteBackfillRemoteSnapshot[] = [
      {
        remoteUrl: "https://one.example/repo.git",
        reachable: true,
        headBranch: "main",
        refs: [
          {ref: "refs/heads/main", name: "main", type: "heads", oid: "1".repeat(40)},
          {ref: "refs/tags/release", name: "release", type: "tags", oid: "a".repeat(40)},
        ],
      },
      {
        remoteUrl: "https://two.example/repo.git",
        reachable: true,
        headBranch: "main",
        refs: [
          {ref: "refs/heads/main", name: "main", type: "heads", oid: "2".repeat(40)},
          {ref: "refs/tags/release", name: "release", type: "tags", oid: "b".repeat(40)},
        ],
      },
      {
        remoteUrl: "https://three.example/repo.git",
        reachable: true,
        headBranch: undefined,
        refs: [],
      },
    ]

    const plan = await buildRemoteBackfillPlanFromSnapshots(snapshots, {
      isDescendent: async () => false,
    })

    expect(plan.summary.readyRefCount).toBe(0)
    expect(plan.summary.conflictRefCount).toBe(2)

    const mainRef = plan.refs.find(ref => ref.ref === "refs/heads/main")
    expect(mainRef).toMatchObject({
      status: "conflict",
      selectedByDefault: false,
      conflictCount: 3,
    })

    const releaseTag = plan.refs.find(ref => ref.ref === "refs/tags/release")
    expect(releaseTag).toMatchObject({
      status: "conflict",
      selectedByDefault: false,
      conflictCount: 3,
    })

    const thirdRemote = plan.remotes.find(
      remote => remote.remoteUrl === "https://three.example/repo.git",
    )
    expect(thirdRemote).toMatchObject({
      selectedByDefault: false,
      createCount: 0,
      fastForwardCount: 0,
      conflictCount: 2,
    })
    expect(thirdRemote?.actions).toEqual([])
    expect(thirdRemote?.conflicts.map(conflict => conflict.ref)).toEqual([
      "refs/heads/main",
      "refs/tags/release",
    ])
  })

  it("pushes standard backfill refs one at a time and preserves partial success", async () => {
    const git: any = {
      init: vi.fn(async () => undefined),
      addRemote: vi.fn(async () => undefined),
      setConfig: vi.fn(async () => undefined),
      readObject: vi.fn(async () => ({})),
      writeRef: vi.fn(async () => undefined),
      listServerRefs: vi.fn(async () => []),
    }

    const pushToRemote = vi.fn(async ({refs}: {refs: string[]}) => {
      const ref = refs[0]
      if (ref === "refs/heads/main") {
        return {success: true, details: {pushedRefs: refs, failedRefs: [], warnings: []}}
      }

      return {
        success: false,
        error: "push declined due to repository rule violations",
      }
    })
    const onProgress = vi.fn()

    const result = await executeRemoteBackfillUtil(
      git,
      {
        repoId: "owner/repo",
        targets: [
          {
            remoteUrl: "https://github.com/owner/repo.git",
            refs: [
              {
                ref: "refs/heads/main",
                name: "main",
                type: "heads",
                effectiveOid: "a".repeat(40),
                sourceUrls: [
                  "https://grasp.example/npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpc4z7/repo.git",
                ],
              },
              {
                ref: "refs/heads/changeset-release/master",
                name: "changeset-release/master",
                type: "heads",
                effectiveOid: "b".repeat(40),
                sourceUrls: [
                  "https://grasp.example/npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpc4z7/repo.git",
                ],
              },
            ],
          },
        ],
      },
      {
        rootDir: "/tmp/budabit-test",
        parseRepoId: id => id.replace(":", "/"),
        onProgress,
        pushToRemote,
      },
    )

    expect(pushToRemote).toHaveBeenCalledTimes(2)
    expect(pushToRemote).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({refs: ["refs/heads/main"]}),
    )
    expect(pushToRemote).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({refs: ["refs/heads/changeset-release/master"]}),
    )
    expect(result.success).toBe(false)
    expect(result.results[0]).toMatchObject({
      remoteUrl: "https://github.com/owner/repo.git",
      success: false,
      pushedRefs: ["refs/heads/main"],
      failedRefs: [
        {
          ref: "refs/heads/changeset-release/master",
          error: "push declined due to repository rule violations",
        },
      ],
    })
    expect(result.summary.pushedRefCount).toBe(1)
    expect(result.summary.failedRefCount).toBe(1)
    expect(onProgress).toHaveBeenCalledWith(
      expect.stringContaining("Backfill: preparing staged refs"),
      0,
      2,
    )
    expect(onProgress).toHaveBeenCalledWith(
      expect.stringContaining("Backfill: pushing branch main to github.com"),
      0,
      2,
    )
    expect(onProgress).toHaveBeenCalledWith(
      expect.stringContaining("Backfill: failed branch changeset-release/master on github.com"),
      2,
      2,
    )
    expect(onProgress).not.toHaveBeenCalledWith(
      expect.stringContaining("Backfill: pushed branch changeset-release/master to github.com"),
      expect.anything(),
      expect.anything(),
    )
  })
})
