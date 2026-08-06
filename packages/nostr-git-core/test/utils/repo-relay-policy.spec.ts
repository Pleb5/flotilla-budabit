import {describe, expect, it} from "vitest"
import {nip19} from "nostr-tools"

import {
  buildRepoNaddrFromEvent,
  getRepoActivityRelays,
  resolveRepoRelayPolicy,
} from "../../src/utils/repo-relay-policy.js"

const pubkey = "1".repeat(64)

describe("getRepoActivityRelays", () => {
  const announcement = (tags: unknown[] = []) => ({
    kind: 30617,
    pubkey,
    tags: [["d", "repo"], ...tags],
  })

  it("uses only normalized relays declared by the matching announcement", () => {
    expect(
      getRepoActivityRelays(
        announcement([
          ["relays", "wss://REPO.example/", "wss://repo.example"],
          ["clone", "https://relay.ngit.dev/owner/repo.git"],
        ]),
        {pubkey, identifier: "repo"},
      ),
    ).toEqual(["wss://repo.example"])
  })

  it("rejects malformed announcements", () => {
    expect(
      getRepoActivityRelays({
        kind: 30617,
        pubkey,
        tags: [
          ["d", "repo"],
          ["relays", 42],
        ],
      }),
    ).toEqual([])
  })

  it("rejects coordinate mismatches", () => {
    const event = announcement([["relays", "wss://repo.example"]])

    expect(getRepoActivityRelays(event, {pubkey: "2".repeat(64), identifier: "repo"})).toEqual([])
    expect(getRepoActivityRelays(event, {pubkey, identifier: "other"})).toEqual([])
  })

  it("rejects missing and relayless announcements", () => {
    expect(getRepoActivityRelays(undefined, {pubkey, identifier: "repo"})).toEqual([])
    expect(getRepoActivityRelays(announcement(), {pubkey, identifier: "repo"})).toEqual([])
    expect(
      getRepoActivityRelays(announcement([["relays", "not a relay"]]), {
        pubkey,
        identifier: "repo",
      }),
    ).toEqual([])
  })
})

describe("resolveRepoRelayPolicy", () => {
  it("uses only tagged repo relays for GRASP events", () => {
    const event = {
      kind: 30617,
      tags: [
        ["d", "repo"],
        [
          "clone",
          "https://relay.ngit.dev/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/repo.git",
        ],
        ["relays", "wss://repo-relay.example"],
      ],
    }

    const policy = resolveRepoRelayPolicy({
      event,
      fallbackRepoRelays: ["wss://fallback.example"],
    })

    expect(policy.isGrasp).toBe(true)
    expect(policy.repoRelays).toEqual(["wss://repo-relay.example"])
    expect(policy.naddrRelays).toEqual(["wss://repo-relay.example"])
  })

  it("keeps publication fallback relays separate from activity scope", () => {
    const event = {
      kind: 30617,
      pubkey,
      tags: [
        ["d", "repo"],
        ["clone", "https://github.com/owner/repo.git"],
        ["relays", "wss://repo-relay.example"],
      ],
    }

    const policy = resolveRepoRelayPolicy({
      event,
      fallbackRepoRelays: ["wss://fallback.example"],
    })

    expect(policy.isGrasp).toBe(false)
    expect(policy.repoRelays).toEqual(["wss://repo-relay.example", "wss://fallback.example"])
    expect(policy.activityRelays).toEqual(["wss://repo-relay.example"])
  })

  it("keeps fallback relays out of naddr hints when a relays tag exists", () => {
    const event = {
      kind: 30617,
      tags: [
        ["d", "repo"],
        ["clone", "https://github.com/owner/repo.git"],
        ["relays", "wss://repo-relay.example"],
      ],
    }

    const policy = resolveRepoRelayPolicy({
      event,
      fallbackRepoRelays: ["wss://fallback.example"],
    })

    expect(policy.naddrRelays).toEqual(["wss://repo-relay.example"])
  })

  it("falls back to caller repo relays for naddr hints when no relays tag exists", () => {
    const event = {
      kind: 30617,
      tags: [
        ["d", "repo"],
        ["clone", "https://github.com/owner/repo.git"],
      ],
    }

    const policy = resolveRepoRelayPolicy({
      event,
      fallbackRepoRelays: ["wss://fallback.example"],
    })

    expect(policy.naddrRelays).toEqual(["wss://fallback.example"])
  })

  it("drops local relays from naddr hints", () => {
    const event = {
      kind: 30617,
      tags: [
        ["d", "repo"],
        ["clone", "https://github.com/owner/repo.git"],
        ["relays", "ws://localhost:3334", "wss://repo-relay.example"],
      ],
    }

    const policy = resolveRepoRelayPolicy({event})

    expect(policy.naddrRelays).toEqual(["wss://repo-relay.example"])
  })
})

describe("buildRepoNaddrFromEvent", () => {
  it("encodes only announcement relays as naddr hints", () => {
    const event = {
      kind: 30617,
      pubkey,
      tags: [
        ["d", "repo"],
        ["clone", "https://github.com/owner/repo.git"],
        ["relays", "wss://repo-relay.example"],
      ],
    }

    const naddr = buildRepoNaddrFromEvent({event})

    const decoded = nip19.decode(naddr!)
    expect(decoded.type).toBe("naddr")
    expect(decoded.data).toMatchObject({
      kind: 30617,
      pubkey,
      identifier: "repo",
      relays: ["wss://repo-relay.example"],
    })
  })
})
