import {describe, expect, it, vi} from "vitest"

// Avoid loading UI components in a node test; keep the real policy/
// coordinator/community-state module graph, including its circular references.
vi.mock("@nostr-git/ui", async () => {
  const {writable} = await import("svelte/store")
  return {graspServersStore: writable([])}
})

describe("relay authentication policy", () => {
  it("loads the real policy adapters without initialization-order dependencies", async () => {
    const policies = await import("../util/policies")
    expect(typeof policies.authPolicy).toBe("function")
    expect(typeof policies.trustPolicy).toBe("function")
  })
})
