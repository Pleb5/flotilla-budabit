import {describe, expect, it} from "vitest"
import {
  buildProfileCodeTrustAnalysis,
  PROFILE_CODE_TRUST_WINDOW_DAYS,
} from "./profile-collab-analysis"

const targetPubkey = "a".repeat(64)
const trustedMaintainer = "b".repeat(64)
const trustedAuthor = "c".repeat(64)
const untrustedMaintainer = "d".repeat(64)
const repoAddress = `30617:${targetPubkey}:demo`

describe("profile code trust analysis", () => {
  it("counts trusted merged PRs, maintainer merges, and collaborators", () => {
    const analysis = buildProfileCodeTrustAnalysis({
      targetPubkey,
      trustGraph: {
        viewerPubkey: "f".repeat(64),
        source: "basic_wot",
        scores: new Map([
          [trustedMaintainer, 4],
          [trustedAuthor, 3],
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
          pubkey: trustedAuthor,
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
          pubkey: trustedMaintainer,
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
          pubkey: untrustedMaintainer,
          created_at: 60,
          tags: [["e", "3".repeat(64), "", "root"]],
        },
      ] as any,
      effectiveMaintainers: new Map([[repoAddress, new Set([targetPubkey, trustedMaintainer])]]),
      repoNamesByAddress: new Map([[repoAddress, "demo"]]),
      relays: ["wss://git.example.com"],
      analyzedAt: 123,
    })

    expect(analysis.graphSource).toBe("basic_wot")
    expect(analysis.windowDays).toBe(PROFILE_CODE_TRUST_WINDOW_DAYS)
    expect(analysis.trustedMergedPullRequests).toBe(1)
    expect(analysis.trustedMaintainerMerges).toBe(1)
    expect(analysis.trustedCollaborators).toBe(2)
    expect(analysis.authoredPullRequestCount).toBe(2)
    expect(analysis.maintainerActionCount).toBe(1)
    expect(analysis.trustedMergedPullRequestDetails).toEqual([
      expect.objectContaining({
        rootId: "1".repeat(64),
        repoName: "demo",
        mergedByPubkey: trustedMaintainer,
      }),
    ])
    expect(analysis.trustedMaintainerMergeDetails).toEqual([
      expect.objectContaining({
        rootId: "2".repeat(64),
        repoName: "demo",
        authorPubkey: trustedAuthor,
      }),
    ])
    expect(analysis.authoredPullRequestDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({rootId: "3".repeat(64), repoName: "demo"}),
        expect.objectContaining({
          rootId: "1".repeat(64),
          repoName: "demo",
          mergedByPubkey: trustedMaintainer,
        }),
      ]),
    )
    expect(analysis.maintainerActionDetails).toEqual([
      expect.objectContaining({
        rootId: "2".repeat(64),
        repoName: "demo",
        authorPubkey: trustedAuthor,
      }),
    ])
    expect(analysis.collaborators).toEqual([
      expect.objectContaining({
        pubkey: trustedMaintainer,
        mergedTargetPullRequests: 1,
        mergedByTarget: 0,
        totalInteractions: 1,
        repoNames: ["demo"],
        mergedTargetPullRequestDetails: [expect.objectContaining({rootId: "1".repeat(64)})],
        repoDetails: [expect.objectContaining({repoName: "demo", count: 1})],
      }),
      expect.objectContaining({
        pubkey: trustedAuthor,
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
        source: "basic_wot",
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
      effectiveMaintainers: new Map([[repoAddress, new Set([targetPubkey])]]),
      analyzedAt: 123,
    })

    expect(analysis.trustedMergedPullRequests).toBe(1)
    expect(analysis.trustedMaintainerMerges).toBe(0)
    expect(analysis.trustedCollaborators).toBe(0)
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
