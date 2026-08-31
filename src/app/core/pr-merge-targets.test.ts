import {describe, expect, it} from "vitest"
import {
  buildPrAnalysisIdentity,
  planPrMergeRemotes,
  resolvePrTargetBranch,
} from "./pr-merge-targets"

describe("PR merge target planning", () => {
  it("keeps announcement order and only labels exact configured matches", () => {
    expect(
      planPrMergeRemotes({
        declaredCloneUrls: [
          "https://primary.example/repo.git",
          "https://mirror.example/repo.git",
          "https://mirror.example/repo.git",
        ],
        configuredRemotes: [
          {remote: "mirror", url: "https://mirror.example/repo.git"},
          {remote: "local-only", url: "https://local.example/repo.git"},
        ],
      }),
    ).toEqual({
      primaryUrl: "https://primary.example/repo.git",
      primaryPushCapable: true,
      remotes: [
        {remote: "remote-1", url: "https://primary.example/repo.git", primary: true},
        {remote: "mirror", url: "https://mirror.example/repo.git", primary: false},
      ],
    })
  })

  it("does not promote a later remote when the declared primary is unusable", () => {
    expect(
      planPrMergeRemotes({
        declaredCloneUrls: ["nostr://repo", "https://mirror.example/repo.git"],
      }),
    ).toEqual({
      primaryUrl: "nostr://repo",
      primaryPushCapable: false,
      remotes: [{remote: "remote-1", url: "https://mirror.example/repo.git", primary: false}],
    })
  })

  it("resolves explicit targets strictly and absent targets from the repository default", () => {
    const normalize = (branch: string) => branch.trim().replace(/^refs\/heads\//, "")

    expect(
      resolvePrTargetBranch({
        targetBranch: "refs/heads/release",
        repositoryDefaultBranch: "main",
        normalize,
      }),
    ).toEqual({branch: "release", source: "explicit"})
    expect(resolvePrTargetBranch({repositoryDefaultBranch: "main", normalize})).toEqual({
      branch: "main",
      source: "repository-default",
    })
    expect(
      resolvePrTargetBranch({targetBranch: " ", repositoryDefaultBranch: "main", normalize}),
    ).toEqual({
      error: "This PR has an invalid target-branch tag.",
    })
    expect(resolvePrTargetBranch({normalize})).toEqual({
      error: "The repository default branch could not be determined.",
    })
  })

  it("identifies analysis by root, tip, exact target, announcement, and primary URL", () => {
    const base = {
      rootId: "root",
      tipOid: "tip",
      targetBranch: "main",
      targetOid: "target-a",
      announcementId: "announcement",
      primaryUrl: "https://primary.example/repo.git",
    }

    expect(buildPrAnalysisIdentity(base)).not.toBe(
      buildPrAnalysisIdentity({...base, targetOid: "target-b"}),
    )
    expect(buildPrAnalysisIdentity(base)).not.toBe(
      buildPrAnalysisIdentity({...base, primaryUrl: "https://mirror.example/repo.git"}),
    )
  })
})
