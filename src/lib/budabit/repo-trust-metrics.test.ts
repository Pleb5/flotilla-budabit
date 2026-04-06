import {describe, expect, it} from "vitest"
import {buildRepoTrustMetrics} from "./repo-trust-metrics"

describe("repo trust metrics", () => {
  it("computes trusted merged contributions, maintainer merges, and collaborators", () => {
    const repoAddress = `30617:${"1".repeat(64)}:demo`
    const trustedAuthor = "2".repeat(64)
    const trustedMaintainer = "3".repeat(64)
    const untrustedAuthor = "4".repeat(64)

    const metrics = buildRepoTrustMetrics({
      pullRequests: [
        {
          id: "a".repeat(64),
          kind: 1618,
          pubkey: trustedAuthor,
          created_at: 10,
          tags: [["a", repoAddress]],
        },
        {
          id: "b".repeat(64),
          kind: 1618,
          pubkey: untrustedAuthor,
          created_at: 20,
          tags: [["a", repoAddress]],
        },
      ] as any,
      appliedStatuses: [
        {
          id: "c".repeat(64),
          kind: 1631,
          pubkey: trustedMaintainer,
          created_at: 30,
          tags: [["e", "a".repeat(64), "", "root"]],
        },
        {
          id: "d".repeat(64),
          kind: 1631,
          pubkey: trustedMaintainer,
          created_at: 40,
          tags: [["e", "b".repeat(64), "", "root"]],
        },
      ] as any,
      effectiveMaintainersByRepoAddress: new Map([[repoAddress, new Set([trustedMaintainer])]]),
      trustGraph: {
        viewerPubkey: "9".repeat(64),
        source: "adjusted_wot",
        scores: new Map([
          [trustedAuthor, 7],
          [trustedMaintainer, 5],
        ]),
        enabledRuleCount: 2,
      },
    })

    expect(metrics.graphSource).toBe("adjusted_wot")
    expect(metrics.totalPullRequests).toBe(2)
    expect(metrics.mergedPullRequests).toBe(2)
    expect(metrics.trustedMergedContributions).toBe(1)
    expect(metrics.trustedMaintainerMerges).toBe(2)
    expect(metrics.trustedCollaborators).toBe(2)
    expect(metrics.trustedAuthors).toBe(1)
    expect(metrics.trustedMaintainers).toBe(1)
    expect(metrics.byRootId.get("a".repeat(64))).toEqual(
      expect.objectContaining({trustedAuthor: true, trustedMaintainerMerge: true}),
    )
    expect(metrics.byRootId.get("b".repeat(64))).toEqual(
      expect.objectContaining({trustedAuthor: false, trustedMaintainerMerge: true}),
    )
    expect(metrics.topActors[0]).toEqual(
      expect.objectContaining({pubkey: trustedMaintainer, appliedMergedPullRequests: 2}),
    )
  })

  it("ignores applied statuses from non-maintainers", () => {
    const repoAddress = `30617:${"1".repeat(64)}:demo`
    const author = "2".repeat(64)
    const outsider = "3".repeat(64)

    const metrics = buildRepoTrustMetrics({
      pullRequests: [
        {
          id: "a".repeat(64),
          kind: 1618,
          pubkey: author,
          created_at: 10,
          tags: [["a", repoAddress]],
        },
      ] as any,
      appliedStatuses: [
        {
          id: "c".repeat(64),
          kind: 1631,
          pubkey: outsider,
          created_at: 30,
          tags: [["e", "a".repeat(64), "", "root"]],
        },
      ] as any,
      effectiveMaintainersByRepoAddress: new Map([[repoAddress, new Set(["f".repeat(64)])]]),
      trustGraph: {
        viewerPubkey: "9".repeat(64),
        source: "basic_wot",
        scores: new Map([
          [author, 3],
          [outsider, 4],
        ]),
        enabledRuleCount: 0,
      },
    })

    expect(metrics.mergedPullRequests).toBe(0)
    expect(metrics.trustedMergedContributions).toBe(0)
    expect(metrics.trustedMaintainerMerges).toBe(0)
    expect(metrics.trustedCollaborators).toBe(0)
    expect(metrics.byRootId.get("a".repeat(64))).toEqual(
      expect.objectContaining({merged: false, trustedMaintainerMerge: false}),
    )
  })

  it("does not count trusted authors or collaborators for unmerged pull requests", () => {
    const repoAddress = `30617:${"1".repeat(64)}:demo`
    const trustedAuthor = "2".repeat(64)

    const metrics = buildRepoTrustMetrics({
      pullRequests: [
        {
          id: "a".repeat(64),
          kind: 1618,
          pubkey: trustedAuthor,
          created_at: 10,
          tags: [["a", repoAddress]],
        },
      ] as any,
      appliedStatuses: [],
      effectiveMaintainersByRepoAddress: new Map([[repoAddress, new Set(["f".repeat(64)])]]),
      trustGraph: {
        viewerPubkey: "9".repeat(64),
        source: "basic_wot",
        scores: new Map([[trustedAuthor, 4]]),
        enabledRuleCount: 0,
      },
    })

    expect(metrics.mergedPullRequests).toBe(0)
    expect(metrics.trustedMergedContributions).toBe(0)
    expect(metrics.trustedAuthors).toBe(0)
    expect(metrics.trustedCollaborators).toBe(0)
    expect(metrics.byRootId.get("a".repeat(64))).toEqual(
      expect.objectContaining({trustedAuthor: true, merged: false}),
    )
  })
})
