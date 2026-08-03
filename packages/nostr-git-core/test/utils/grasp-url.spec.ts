import {describe, expect, it} from "vitest"
import {nip19} from "nostr-tools"

import {
  findMatchingGraspRepoCloneUrl,
  isGraspRelayUrl,
  isGraspRepoHttpUrl,
  normalizeGraspServiceHttpBase,
  normalizeGraspServiceRelayUrl,
  parseGraspRepoHttpUrl,
  resolveCorsProxyForUrl,
} from "../../src/utils/grasp-url.js"

describe("grasp-url utilities", () => {
  it("matches strict GRASP Smart HTTP clone URLs", () => {
    expect(
      isGraspRepoHttpUrl(
        "https://pyramid.fiatjaf.com/npub1elta7cneng3w8p9y4dw633qzdjr4kyvaparuyuttyrx6e8xp7xnq32cume/societybuilder.git",
      ),
    ).toBe(true)
    expect(isGraspRepoHttpUrl("https://relay.ngit.dev/owner/repo.git")).toBe(false)
    expect(isGraspRepoHttpUrl("https://relay.ngit.dev/%E0%A4%A/repo.git")).toBe(false)
    expect(
      isGraspRepoHttpUrl(
        "https://relay.ngit.dev/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/repo.git?tenant=a",
      ),
    ).toBe(false)
    expect(
      isGraspRepoHttpUrl(
        "https://relay.ngit.dev/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/group%2Frepo.git",
      ),
    ).toBe(false)
  })

  it("decodes identifiers while preserving the canonical GRASP base path", () => {
    expect(
      parseGraspRepoHttpUrl(
        "https://relay.ngit.dev/git/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/my%20repo.git",
      ),
    ).toEqual({
      ownerNpub: "npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw",
      identifier: "my repo",
      httpBase: "https://relay.ngit.dev/git",
    })
  })

  it("matches bare GRASP relay origins without treating repo paths as relays", () => {
    expect(isGraspRelayUrl("wss://relay.example")).toBe(true)
    expect(isGraspRelayUrl("wss://relay.example/npub1owner/repo.git")).toBe(false)
  })

  it("normalizes service bases while preserving deployment paths", () => {
    expect(normalizeGraspServiceHttpBase("wss://Relay.Example/git/")).toBe(
      "https://relay.example/git",
    )
    expect(normalizeGraspServiceRelayUrl("https://Relay.Example/git/")).toBe(
      "wss://relay.example/git",
    )
  })

  it("matches only the exact service, owner, and repository identifier", () => {
    const ownerPubkey = "a".repeat(64)
    const ownerNpub = nip19.npubEncode(ownerPubkey)
    const matchingUrl = `https://relay.example/git/${ownerNpub}/repo.git`

    expect(
      findMatchingGraspRepoCloneUrl([matchingUrl], {
        relayUrl: "wss://nostr.example",
        httpBaseAliases: ["https://relay.example/git"],
        ownerPubkey,
        identifier: "repo",
      })?.url,
    ).toBe(matchingUrl)
    expect(
      findMatchingGraspRepoCloneUrl([matchingUrl], {
        relayUrl: "wss://relay.example/git",
        ownerPubkey: "b".repeat(64),
        identifier: "repo",
      }),
    ).toBeNull()
    expect(
      findMatchingGraspRepoCloneUrl([matchingUrl], {
        relayUrl: "wss://relay.example/git",
        ownerPubkey,
        identifier: "other",
      }),
    ).toBeNull()
    expect(
      findMatchingGraspRepoCloneUrl([matchingUrl], {
        relayUrl: "wss://relay.example",
        ownerPubkey,
        identifier: "repo",
      }),
    ).toBeNull()
  })

  it("forces direct transport for grasp-like HTTP remotes", () => {
    const url =
      "https://relay.ngit.dev/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/flotilla-budabit.git"

    expect(resolveCorsProxyForUrl(url, "https://cors.isomorphic-git.org")).toBeNull()
  })

  it("preserves the fallback proxy for non-grasp remotes", () => {
    expect(
      resolveCorsProxyForUrl(
        "https://github.com/Pleb5/flotilla-budabit.git",
        "https://cors.isomorphic-git.org",
      ),
    ).toBe("https://cors.isomorphic-git.org")
  })

  it("preserves undefined fallback for non-grasp remotes", () => {
    expect(resolveCorsProxyForUrl("https://github.com/Pleb5/flotilla-budabit.git")).toBeUndefined()
  })
})
