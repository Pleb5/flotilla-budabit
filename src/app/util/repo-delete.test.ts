import {describe, expect, it} from "vitest"
import {
  buildRepoOwnedDeleteFilters,
  getGraspRepoDeleteTarget,
  getRepoDeleteAddresses,
  matchesRepoDeleteEvent,
} from "./repo-delete"
import {nip19} from "nostr-tools"

describe("repo delete helpers", () => {
  it("deduplicates repo delete addresses and keeps fallback", () => {
    expect(
      getRepoDeleteAddresses(
        ["30617:alice:repo", "30617:alice:repo", "30617:alice:repo-renamed"],
        "30617:alice:repo",
      ),
    ).toEqual(["30617:alice:repo", "30617:alice:repo-renamed"])
  })

  it("matches delete events against any effective repo address", () => {
    const event = {
      tags: [["repo", "30617:alice:repo-renamed"]],
    }

    expect(matchesRepoDeleteEvent(event, ["30617:alice:repo-renamed"], "30617:alice:repo")).toBe(
      true,
    )
    expect(matchesRepoDeleteEvent(event, ["30617:alice:repo-other"], "30617:alice:repo")).toBe(
      false,
    )
  })

  it("builds repo-owned delete filters across all effective addresses", () => {
    const filters = buildRepoOwnedDeleteFilters({
      pubkey: "a".repeat(64),
      repoName: "repo",
      repoAddresses: ["30617:alice:repo", "30617:alice:repo-renamed"],
    })

    expect(filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({"#d": ["repo"]}),
        expect.objectContaining({"#a": ["30617:alice:repo", "30617:alice:repo-renamed"]}),
      ]),
    )
  })

  it("derives an owner-matched GRASP relay from a clone URL", () => {
    const ownerPubkey = "a".repeat(64)
    const ownerNpub = nip19.npubEncode(ownerPubkey)

    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: `https://grasp.example/${ownerNpub}/repo.git`,
        ownerPubkey,
        identifier: "repo",
      }),
    ).toEqual({
      relay: "wss://grasp.example",
      ownerNpub,
      identifier: "repo",
    })
  })

  it("rejects GRASP clone URLs for another owner or repository", () => {
    const ownerPubkey = "a".repeat(64)
    const ownerNpub = nip19.npubEncode(ownerPubkey)

    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: `https://grasp.example/${ownerNpub}/other.git`,
        ownerPubkey,
        identifier: "repo",
      }),
    ).toBeNull()
    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: `https://grasp.example/${nip19.npubEncode("b".repeat(64))}/repo.git`,
        ownerPubkey,
        identifier: "repo",
      }),
    ).toBeNull()
  })
})
