import {describe, expect, it} from "vitest"
import {
  buildRepoExtensionContext,
  buildRepoExtensionUpdate,
  getRepoExtensionInstanceId,
} from "./repo-context"
import {getRepoAddress} from "./types"

const owner = "a".repeat(64)
const relays = ["wss://repo.example/"]
const source = (identifier: string, name: string, pubkey = owner) => ({
  repoEvent: {pubkey, tags: [["d", identifier] as ["d", string]]},
  identifier,
  name,
})

describe("repository extension context", () => {
  it("keeps exact identity fields stable while exposing a renamed display name separately", () => {
    const before = buildRepoExtensionContext(
      source("Legacy:Case", "My Great Repo"),
      "naddr",
      relays,
    )!
    const after = buildRepoExtensionContext(
      source("Legacy:Case", "名前 with spaces!"),
      "naddr",
      relays,
    )!
    expect(after.name).toBe("Legacy:Case")
    expect(after.displayName).toBe("名前 with spaces!")
    expect(getRepoAddress(after)).toBe(`30617:${owner}:Legacy:Case`)
    expect(getRepoExtensionInstanceId("builds", after)).toBe(
      getRepoExtensionInstanceId("builds", before),
    )
    expect(buildRepoExtensionUpdate(after, null)).toMatchObject({
      contextId: buildRepoExtensionUpdate(before, null).contextId,
      repo: {
        repoName: "Legacy:Case",
        repoDisplayName: "名前 with spaces!",
        repoAddress: `30617:${owner}:Legacy:Case`,
        userPubkey: null,
        maintainers: [owner],
      },
    })
  })
  it("separates equal display names by the exact owner/identifier coordinate", () => {
    const contexts = [
      source("first", "Same name"),
      source("second", "Same name"),
      source("first", "Same name", "b".repeat(64)),
    ].map(repo => buildRepoExtensionContext(repo, "naddr", relays)!)
    expect(new Set(contexts.map(getRepoAddress)).size).toBe(3)
    expect(new Set(contexts.map(ctx => getRepoExtensionInstanceId("builds", ctx))).size).toBe(3)
    expect(new Set(contexts.map(ctx => buildRepoExtensionUpdate(ctx, null).contextId)).size).toBe(3)
  })
  it("requires identity and declared relays instead of falling back to presentation text", () => {
    expect(buildRepoExtensionContext(source("", "Name only"), "naddr", relays)).toBeUndefined()
    expect(buildRepoExtensionContext(source("id", "Name"), "naddr", [])).toBeUndefined()
  })
})
