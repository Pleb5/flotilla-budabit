import {describe, expect, it} from "vitest"

import {resolveRepoRelayPolicy} from "../../src/utils/repo-relay-policy.js"

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
})
