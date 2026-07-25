import {describe, expect, it} from "vitest"
import {nip19} from "nostr-tools"

import {buildRepoNaddrFromEvent, resolveRepoRelayPolicy} from "../../src/utils/repo-relay-policy.js"

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
      userOutboxRelays: ["wss://outbox.example"],
      gitRelays: ["wss://git.example"],
    })

    expect(policy.isGrasp).toBe(true)
    expect(policy.repoRelays).toEqual(["wss://repo-relay.example"])
    expect(policy.publishRelays).toEqual(["wss://repo-relay.example"])
    expect(policy.naddrRelays).toEqual(["wss://repo-relay.example"])
  })

  it("includes fallback, outbox, and git relays for non-GRASP events", () => {
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
      userOutboxRelays: ["wss://outbox.example"],
      gitRelays: ["wss://git.example"],
    })

    expect(policy.isGrasp).toBe(false)
    expect(policy.repoRelays).toEqual(["wss://repo-relay.example", "wss://fallback.example"])
    expect(policy.publishRelays).toEqual([
      "wss://repo-relay.example",
      "wss://fallback.example",
      "wss://outbox.example",
      "wss://git.example",
    ])
  })

  it("keeps outbox and git relays out of naddr hints for non-GRASP events", () => {
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
      userOutboxRelays: ["wss://outbox.example"],
      gitRelays: ["wss://git.example"],
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
      userOutboxRelays: ["wss://outbox.example"],
      gitRelays: ["wss://git.example"],
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
    const pubkey = "1".repeat(64)
    const event = {
      kind: 30617,
      pubkey,
      tags: [
        ["d", "repo"],
        ["clone", "https://github.com/owner/repo.git"],
        ["relays", "wss://repo-relay.example"],
      ],
    }

    const naddr = buildRepoNaddrFromEvent({
      event,
      userOutboxRelays: ["wss://outbox.example"],
      gitRelays: ["wss://git.example"],
    })

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
