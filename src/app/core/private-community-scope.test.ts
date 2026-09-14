import {describe, expect, it} from "vitest"
import {makeCommunityPointer} from "./community-protocol"
import {
  resolvePrivateCommunityScope,
  getPrivateCommunityScope,
  makePrivateCommunityInvite,
  privateRelayHints,
} from "./private-community-scope"

const pointer = (id: string) =>
  makeCommunityPointer({
    ownerPubkey: "1".repeat(64),
    communityId: id.repeat(64),
    relayHints: ["wss://private.example/"],
  })!
describe("private invitation scope", () => {
  it("does not mark ordinary routes private or infer it from auth-required alone", () => {
    expect(
      resolvePrivateCommunityScope(new URL(`/c/${pointer("a").naddr}`, "https://budabit.test")),
    ).toBeUndefined()
    expect(
      resolvePrivateCommunityScope(new URL("/explore?read-access=members", "https://budabit.test")),
    ).toBeUndefined()
  })
  it("pins explicit relays, persists without private event data and survives removing query on navigation", () => {
    const p = pointer("b"),
      relay = "wss://private.example/path"
    const scope = resolvePrivateCommunityScope(
      new URL(makePrivateCommunityInvite(p, [relay]), "https://budabit.test"),
    )!
    expect(scope.relays).toEqual([relay])
    expect(
      resolvePrivateCommunityScope(new URL(`/c/${p.naddr}/threads`, "https://budabit.test"))
        ?.relays,
    ).toEqual([relay])
    expect(JSON.parse(sessionStorage.getItem(`budabit:private-invite:v1:${p.address}`)!)).toEqual({
      version: 1,
      relays: [relay],
    })
  })
  it("restores a scope from session storage and fails closed for damaged saved markers", () => {
    const p = pointer("c")
    sessionStorage.setItem(`budabit:private-invite:v1:${p.address}`, "invalid")
    expect(getPrivateCommunityScope(p)?.error).toBeTruthy()
    expect(getPrivateCommunityScope(p)?.relays).toEqual([])
    sessionStorage.setItem(
      `budabit:private-invite:v1:${p.address}`,
      JSON.stringify({version: 1, relays: ["wss://restore.example/"]}),
    )
    expect(getPrivateCommunityScope(p)?.relays).toEqual(["wss://restore.example/"])
  })
  it("rejects insecure remote relays, credentials, malformed hints, and too many destinations", () => {
    for (const hints of [
      ["http://relay.example"],
      ["ws://relay.example"],
      ["wss://user:password@relay.example"],
      ["wss://relay.example/#fragment"],
      Array(9).fill("wss://relay.example"),
    ])
      expect(privateRelayHints(hints)).toEqual([])
    expect(privateRelayHints(["ws://localhost:18742"])).toEqual(["ws://localhost:18742/"])
    const p = pointer("d")
    const scope = resolvePrivateCommunityScope(
      new URL(`/c/${p.naddr}?read-access=members&relay=invalid`, "https://budabit.test"),
    )
    expect(scope?.error).toBeTruthy()
  })
})
