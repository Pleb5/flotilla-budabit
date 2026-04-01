import {describe, expect, it} from "vitest"
import {buildRepoOwnedDeleteFilters, getRepoDeleteAddresses, matchesRepoDeleteEvent} from "./delete"

describe("budabit delete helpers", () => {
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
})
