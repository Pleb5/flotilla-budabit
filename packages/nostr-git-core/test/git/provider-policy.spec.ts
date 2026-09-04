import {describe, expect, it, vi} from "vitest"

import {
  ENABLE_BITBUCKET_PROVIDER,
  ENABLE_DIRECT_NOSTR_GIT_PROVIDER,
  assertDirectNostrGitProviderEnabled,
  assertGitVendorEnabled,
  isGitVendorEnabled,
} from "../../src/git/provider-policy.js"
import {
  assertGitRemoteUrlEnabled,
  detectVendorFromUrl,
  isGitRemoteUrlEnabled,
} from "../../src/git/vendor-providers.js"
import {BitbucketApi} from "../../src/api/providers/bitbucket.js"
import {NostrGitProvider} from "../../src/api/providers/nostr-git-provider.js"

describe("Git provider policy", () => {
  it("disables Bitbucket without changing URL classification", () => {
    expect(ENABLE_BITBUCKET_PROVIDER).toBe(false)
    expect(detectVendorFromUrl("https://bitbucket.org/team/repo.git")).toBe("bitbucket")
    expect(isGitVendorEnabled("bitbucket")).toBe(false)
    expect(isGitRemoteUrlEnabled("https://bitbucket.org/team/repo.git")).toBe(false)
    expect(() => assertGitVendorEnabled("bitbucket", "test")).toThrow(
      /Bitbucket provider is disabled for test/i,
    )
    expect(() =>
      assertGitRemoteUrlEnabled("https://bitbucket.org/team/repo.git", "clone"),
    ).toThrow(/Bitbucket provider is disabled for clone/i)

    const npub = "npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw"
    const graspShapedBitbucketUrl = `https://bitbucket.org/${npub}/repo.git`
    expect(detectVendorFromUrl(graspShapedBitbucketUrl)).toBe("bitbucket")
    expect(isGitRemoteUrlEnabled(graspShapedBitbucketUrl)).toBe(false)
  })

  it("keeps enabled Git and GRASP providers available", () => {
    for (const provider of ["github", "gitlab", "gitea", "generic", "grasp", "grasp-rest"] as const) {
      expect(isGitVendorEnabled(provider)).toBe(true)
    }
    expect(
      isGitRemoteUrlEnabled(
        "https://relay.example/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/repo.git",
      ),
    ).toBe(true)
  })

  it("disables the direct NostrGitProvider", () => {
    expect(ENABLE_DIRECT_NOSTR_GIT_PROVIDER).toBe(false)
    expect(isGitRemoteUrlEnabled("NOSTR://repo")).toBe(false)
    expect(() => assertGitRemoteUrlEnabled("NOSTR://repo", "clone")).toThrow(
      /Direct NostrGitProvider is disabled for clone/i,
    )
    expect(() => assertDirectNostrGitProviderEnabled("test")).toThrow(
      /Direct NostrGitProvider is disabled for test/i,
    )
  })

  it("rejects direct construction before disabled providers can perform I/O", () => {
    const fetchEvents = vi.fn()

    expect(() => new BitbucketApi("retained-token")).toThrow(
      /Bitbucket provider is disabled for REST API construction/i,
    )
    expect(
      () => new NostrGitProvider({eventIO: {fetchEvents} as any}),
    ).toThrow(/Direct NostrGitProvider is disabled for provider construction/i)
    expect(fetchEvents).not.toHaveBeenCalled()
  })
})
