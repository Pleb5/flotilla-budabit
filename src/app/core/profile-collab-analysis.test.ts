import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => {
  const getRepoMaintainers = vi.fn((event?: {pubkey?: string; tags?: string[][]} | null) => {
    if (!event) return []

    return Array.from(
      new Set([
        event.pubkey || "",
        ...((event.tags || []).find(tag => tag[0] === "maintainers")?.slice(1) || []),
      ].filter(Boolean)),
    )
  })

  return {
    analysisLoad: vi.fn(),
    getRepoMaintainers,
    loadProfile: vi.fn(() => Promise.resolve()),
    loadRepoAnnouncementByAddress: vi.fn(),
    viewerPubkey: "f".repeat(64),
  }
})

vi.mock("@app/core/git-state", () => ({
  repoAnnouncementsByAddress: {
    subscribe: (run: (value: Map<string, unknown>) => void) => {
      run(new Map())
      return () => undefined
    },
  },
  getRepoMaintainers: mocks.getRepoMaintainers,
  getRepoAnnouncementRelays: vi.fn(() => ["wss://git.example.com"]),
  loadRepoAnnouncementByAddress: mocks.loadRepoAnnouncementByAddress,
}))

vi.mock("@welshman/app", () => ({
  loadProfile: mocks.loadProfile,
  pubkey: {
    get: () => mocks.viewerPubkey,
    subscribe: (run: (value: string) => void) => {
      run(mocks.viewerPubkey)
      return () => undefined
    },
  },
}))

vi.mock("@welshman/net", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/net")>()
  return {
    ...actual,
    makeLoader: vi.fn(() => mocks.analysisLoad),
  }
})
import {
  buildProfileCodeTrustAnalysis,
  loadProfileCodeTrustAnalysis,
  PROFILE_CODE_TRUST_WINDOW_DAYS,
} from "./profile-collab-analysis"

const targetPubkey = "a".repeat(64)
const matchedMaintainer = "b".repeat(64)
const matchedAuthor = "c".repeat(64)
const unmatchedMaintainer = "d".repeat(64)
const repoAddress = `30617:${targetPubkey}:demo`

describe("profile code trust analysis", () => {
  beforeEach(() => {
    mocks.analysisLoad.mockReset()
    mocks.loadProfile.mockClear()
    mocks.loadRepoAnnouncementByAddress.mockReset()
    mocks.getRepoMaintainers.mockClear()
  })

  it("counts maintainer-accepted PRs, community-aligned maintainer merges, and collaborators", () => {
    const analysis = buildProfileCodeTrustAnalysis({
      targetPubkey,
      communityAlignedScores: new Map([
        [matchedMaintainer, 4],
        [matchedAuthor, 3],
      ]),
      communityContextPubkey: "e".repeat(64),
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

    expect(analysis.windowDays).toBe(PROFILE_CODE_TRUST_WINDOW_DAYS)
    expect(analysis.communityContextAvailable).toBe(true)
    expect(analysis.maintainerAcceptedPullRequests).toBe(1)
    expect(analysis.communityAlignedMaintainerMerges).toBe(1)
    expect(analysis.communityCollaborators).toBe(2)
    expect(analysis.authoredPullRequestCount).toBe(2)
    expect(analysis.maintainerActionCount).toBe(1)
    expect(analysis.maintainerAcceptedPullRequestDetails).toEqual([
      expect.objectContaining({
        rootId: "1".repeat(64),
        repoName: "demo",
        mergedByPubkey: matchedMaintainer,
      }),
    ])
    expect(analysis.communityAlignedMaintainerMergeDetails).toEqual([
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
        communityScore: 4,
        mergedTargetPullRequests: 1,
        mergedByTarget: 0,
        totalInteractions: 1,
        repoNames: ["demo"],
        mergedTargetPullRequestDetails: [expect.objectContaining({rootId: "1".repeat(64)})],
        repoDetails: [expect.objectContaining({repoName: "demo", count: 1})],
      }),
      expect.objectContaining({
        pubkey: matchedAuthor,
        communityScore: 3,
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

    expect(analysis.maintainerAcceptedPullRequests).toBe(1)
    expect(analysis.communityAlignedMaintainerMerges).toBe(0)
    expect(analysis.communityCollaborators).toBe(0)
    expect(analysis.authoredPullRequestDetails).toEqual([
      expect.objectContaining({rootId: "1".repeat(64)}),
    ])
    expect(analysis.maintainerActionDetails).toEqual([
      expect.objectContaining({rootId: "1".repeat(64)}),
    ])
    expect(analysis.maintainerActionCount).toBe(1)
    expect(analysis.collaborators).toEqual([])
  })

  it("counts maintainer evidence from repo announcements returned during first load", async () => {
    const repoOwnerPubkey = "1".repeat(64)
    const repoMaintainerPubkey = "2".repeat(64)
    const loadedRepoAddress = `30617:${repoOwnerPubkey}:demo`
    const pullRequestId = "7".repeat(64)
    const pullRequest = {
      id: pullRequestId,
      kind: 1618,
      pubkey: targetPubkey,
      created_at: 10,
      tags: [["a", loadedRepoAddress]],
    }
    const status = {
      id: "8".repeat(64),
      kind: 1631,
      pubkey: repoMaintainerPubkey,
      created_at: 20,
      tags: [["e", pullRequestId, "", "root"]],
    }
    const repoAnnouncement = {
      id: "9".repeat(64),
      kind: 30617,
      pubkey: repoOwnerPubkey,
      created_at: 30,
      tags: [
        ["d", "demo"],
        ["name", "demo"],
        ["maintainers", repoMaintainerPubkey],
      ],
    }

    mocks.analysisLoad.mockResolvedValueOnce([pullRequest]).mockResolvedValueOnce([status])
    mocks.loadRepoAnnouncementByAddress.mockResolvedValueOnce([repoAnnouncement])

    const analysis = await loadProfileCodeTrustAnalysis(targetPubkey, {force: true})

    expect(mocks.loadRepoAnnouncementByAddress).toHaveBeenCalledWith(loadedRepoAddress)
    expect(analysis.maintainerAcceptedPullRequests).toBe(1)
    expect(analysis.maintainerAcceptedPullRequestDetails).toEqual([
      expect.objectContaining({
        rootId: pullRequestId,
        repoName: "demo",
        mergedByPubkey: repoMaintainerPubkey,
      }),
    ])
  })
})
