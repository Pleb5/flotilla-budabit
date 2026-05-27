import {readable} from "svelte/store"
import {describe, expect, it, vi} from "vitest"

vi.mock("@app/core/git-state", () => ({
  repoAnnouncementsByAddress: readable(new Map()),
  getRepoMaintainers: vi.fn(() => []),
  getRepoAnnouncementRelays: vi.fn(() => []),
  loadRepoAnnouncementByAddress: vi.fn(),
}))

vi.mock("./trust-graph", () => ({
  loadActiveTrustGraph: vi.fn(),
}))

vi.mock("@welshman/net", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/net")>()
  return {
    ...actual,
    makeLoader: vi.fn(() => vi.fn()),
  }
})
import {
  buildProfileCodeTrustAnalysis,
  PROFILE_CODE_TRUST_WINDOW_DAYS,
} from "./profile-collab-analysis"

const targetPubkey = "a".repeat(64)
const matchedMaintainer = "b".repeat(64)
const matchedAuthor = "c".repeat(64)
const unmatchedMaintainer = "d".repeat(64)
const repoAddress = `30617:${targetPubkey}:demo`

describe("profile code trust analysis", () => {
  it("counts overlay-matched merged PRs, maintainer merges, and collaborators", () => {
    const analysis = buildProfileCodeTrustAnalysis({
      targetPubkey,
      trustGraph: {
        viewerPubkey: "f".repeat(64),
        source: "direct_social",
        scores: new Map([
          [matchedMaintainer, 4],
          [matchedAuthor, 3],
        ]),
        enabledRuleCount: 0,
      },
      pullRequests: [
        {
          id: "1".repeat(64),
          kind: 1618,
          pubkey: targetPubkey,
          created_at: 10,
          tags: [["a", repoAddress]],
        },
        {
          id: "2".repeat(64),
          kind: 1618,
          pubkey: matchedAuthor,
          created_at: 20,
          tags: [["a", repoAddress]],
        },
        {
          id: "3".repeat(64),
          kind: 1618,
          pubkey: targetPubkey,
          created_at: 30,
          tags: [["a", repoAddress]],
        },
      ] as any,
      appliedStatuses: [
        {
          id: "4".repeat(64),
          kind: 1631,
          pubkey: matchedMaintainer,
          created_at: 40,
          tags: [["e", "1".repeat(64), "", "root"]],
        },
        {
          id: "5".repeat(64),
          kind: 1631,
          pubkey: targetPubkey,
          created_at: 50,
          tags: [["e", "2".repeat(64), "", "root"]],
        },
        {
          id: "6".repeat(64),
          kind: 1631,
          pubkey: unmatchedMaintainer,
          created_at: 60,
          tags: [["e", "3".repeat(64), "", "root"]],
        },
      ] as any,
      repoMaintainersByAddress: new Map([
        [repoAddress, new Set([targetPubkey, matchedMaintainer])],
      ]),
      repoNamesByAddress: new Map([[repoAddress, "demo"]]),
      relays: ["wss://git.example.com"],
      analyzedAt: 123,
    })

    expect(analysis.graphSource).toBe("direct_social")
    expect(analysis.windowDays).toBe(PROFILE_CODE_TRUST_WINDOW_DAYS)
    expect(analysis.overlayMatchedMergedPullRequests).toBe(1)
    expect(analysis.overlayMatchedMaintainerMerges).toBe(1)
    expect(analysis.overlayMatchedCollaborators).toBe(2)
    expect(analysis.authoredPullRequestCount).toBe(2)
    expect(analysis.maintainerActionCount).toBe(1)
    expect(analysis.overlayMatchedMergedPullRequestDetails).toEqual([
      expect.objectContaining({
        rootId: "1".repeat(64),
        repoName: "demo",
        mergedByPubkey: matchedMaintainer,
      }),
    ])
    expect(analysis.overlayMatchedMaintainerMergeDetails).toEqual([
      expect.objectContaining({
        rootId: "2".repeat(64),
        repoName: "demo",
        authorPubkey: matchedAuthor,
      }),
    ])
    expect(analysis.authoredPullRequestDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({rootId: "3".repeat(64), repoName: "demo"}),
        expect.objectContaining({
          rootId: "1".repeat(64),
          repoName: "demo",
          mergedByPubkey: matchedMaintainer,
        }),
      ]),
    )
    expect(analysis.maintainerActionDetails).toEqual([
      expect.objectContaining({
        rootId: "2".repeat(64),
        repoName: "demo",
        authorPubkey: matchedAuthor,
      }),
    ])
    expect(analysis.collaborators).toEqual([
      expect.objectContaining({
        pubkey: matchedMaintainer,
        mergedTargetPullRequests: 1,
        mergedByTarget: 0,
        totalInteractions: 1,
        repoNames: ["demo"],
        mergedTargetPullRequestDetails: [expect.objectContaining({rootId: "1".repeat(64)})],
        repoDetails: [expect.objectContaining({repoName: "demo", count: 1})],
      }),
      expect.objectContaining({
        pubkey: matchedAuthor,
        mergedTargetPullRequests: 0,
        mergedByTarget: 1,
        totalInteractions: 1,
        repoNames: ["demo"],
        mergedByTargetDetails: [expect.objectContaining({rootId: "2".repeat(64)})],
        repoDetails: [expect.objectContaining({repoName: "demo", count: 1})],
      }),
    ])
  })

  it("ignores non-maintainer applied statuses and self as collaborator", () => {
    const analysis = buildProfileCodeTrustAnalysis({
      targetPubkey,
      trustGraph: {
        viewerPubkey: targetPubkey,
        source: "direct_social",
        scores: new Map([[targetPubkey, 5]]),
        enabledRuleCount: 0,
      },
      pullRequests: [
        {
          id: "1".repeat(64),
          kind: 1618,
          pubkey: targetPubkey,
          created_at: 10,
          tags: [["a", repoAddress]],
        },
      ] as any,
      appliedStatuses: [
        {
          id: "2".repeat(64),
          kind: 1631,
          pubkey: targetPubkey,
          created_at: 20,
          tags: [["e", "1".repeat(64), "", "root"]],
        },
      ] as any,
      repoMaintainersByAddress: new Map([[repoAddress, new Set([targetPubkey])]]),
      analyzedAt: 123,
    })

    expect(analysis.overlayMatchedMergedPullRequests).toBe(1)
    expect(analysis.overlayMatchedMaintainerMerges).toBe(0)
    expect(analysis.overlayMatchedCollaborators).toBe(0)
    expect(analysis.authoredPullRequestDetails).toEqual([
      expect.objectContaining({rootId: "1".repeat(64)}),
    ])
    expect(analysis.maintainerActionDetails).toEqual([
      expect.objectContaining({rootId: "1".repeat(64)}),
    ])
    expect(analysis.maintainerActionCount).toBe(1)
    expect(analysis.collaborators).toEqual([])
  })
})
