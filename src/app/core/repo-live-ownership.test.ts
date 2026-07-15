import {get} from "svelte/store"
import {describe, expect, it} from "vitest"
import {
  RepoLiveOwnershipRegistry,
  canonicalizeRepoLiveAddress,
  isRepoLiveOwned,
} from "./repo-live-ownership"

const owner = "a".repeat(64)
const address = `30617:${owner}:repo`

describe("repo live ownership", () => {
  it("keys ownership by canonical address and normalized relay", () => {
    const registry = new RepoLiveOwnershipRegistry()
    const release = registry.register(address, "wss://relay.example")

    expect(canonicalizeRepoLiveAddress(address)).toBe(address)
    expect(isRepoLiveOwned(get(registry.ownership), address, "wss://relay.example/")).toBe(true)

    release()
    expect(isRepoLiveOwned(get(registry.ownership), address, "wss://relay.example")).toBe(false)
  })

  it("reference-counts owners and makes release idempotent", () => {
    const registry = new RepoLiveOwnershipRegistry()
    const releaseFirst = registry.register(address, "wss://relay.example")
    const releaseSecond = registry.register(address, "wss://relay.example/")

    releaseFirst()
    releaseFirst()
    expect(isRepoLiveOwned(get(registry.ownership), address, "wss://relay.example")).toBe(true)

    releaseSecond()
    expect(get(registry.ownership).size).toBe(0)
  })
})
