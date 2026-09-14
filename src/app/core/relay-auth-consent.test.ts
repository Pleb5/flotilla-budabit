import {describe, expect, it, vi, afterEach} from "vitest"
import {get} from "svelte/store"
import {pubkey} from "@welshman/app"
import {userSettingsValues} from "./state"
import {
  allowRelayAuthentication,
  isUserOwnedRelay,
  requireExplicitRelayAuthConsent,
} from "./relay-auth-consent"

// Avoid loading UI components in a node test; keep the real policy/consent/
// coordinator/community-state module graph, including its circular references.
vi.mock("@nostr-git/ui", async () => {
  const {writable} = await import("svelte/store")
  return {graspServersStore: writable([])}
})

afterEach(() => pubkey.set(undefined))
describe("relay authentication consent", () => {
  it("loads the real policy adapters without initialization-order dependencies", async () => {
    const policies = await import("../util/policies")
    expect(typeof policies.authPolicy).toBe("function")
    expect(typeof policies.trustPolicy).toBe("function")
  })

  it("keys private invitation consent to the identity and never grants unsigned-event trust", () => {
    const relay = "wss://invite-auth.example/"
    requireExplicitRelayAuthConsent([relay])
    pubkey.set("1".repeat(64))
    const before = get(userSettingsValues).trusted_relays
    expect(isUserOwnedRelay(relay)).toBe(false)
    allowRelayAuthentication(relay)
    expect(isUserOwnedRelay(relay)).toBe(true)
    expect(get(userSettingsValues).trusted_relays).toEqual(before)
    pubkey.set("2".repeat(64))
    expect(isUserOwnedRelay(relay)).toBe(false)
    pubkey.set(undefined)
    expect(isUserOwnedRelay(relay)).toBe(false)
  })
})
