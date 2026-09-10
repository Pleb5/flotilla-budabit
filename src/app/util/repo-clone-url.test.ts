import {describe, expect, it} from "vitest"
import {nip19} from "nostr-tools"
import {buildDefaultNgitCloneUrl} from "./repo-clone-url"

const owner = "a".repeat(64)
describe("overview Nostr clone URL", () => {
  it.each(["stable-id", "Legacy.Case", "Legacy:Exact/Identifier", " legacy id "])(
    "keeps the exact %s d tag through display-only renames",
    identifier => {
      const repo = {
        repoEvent: {pubkey: owner, tags: [["d", identifier] as ["d", string]]},
        identifier,
        key: `${owner}/sanitized-key`,
        name: "My Great Repo",
      }
      const expected = `nostr://${nip19.npubEncode(owner)}/${identifier}`
      expect(buildDefaultNgitCloneUrl(repo)).toBe(expected)
      repo.name = "名前 with spaces!"
      expect(buildDefaultNgitCloneUrl(repo)).toBe(expected)
    },
  )
  it("does not guess from the display name or local path before identity is loaded", () => {
    const repo = {name: "My Great Repo", key: `${owner}/sanitized-key`}
    expect(
      buildDefaultNgitCloneUrl({...repo, repoEvent: {pubkey: owner, tags: []}}),
    ).toBeUndefined()
    expect(buildDefaultNgitCloneUrl({identifier: "stable-id"})).toBeUndefined()
  })
})
