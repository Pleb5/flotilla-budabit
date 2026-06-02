import {describe, expect, it} from "vitest"

import {
  isGraspRelayUrl,
  isGraspRepoHttpUrl,
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
  })

  it("matches bare GRASP relay origins without treating repo paths as relays", () => {
    expect(isGraspRelayUrl("wss://relay.example")).toBe(true)
    expect(isGraspRelayUrl("wss://relay.example/npub1owner/repo.git")).toBe(false)
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
