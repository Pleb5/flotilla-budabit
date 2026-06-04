import {describe, it, expect} from "vitest"
import "fake-indexeddb/auto"

import {
  detectVendorFromUrl,
  extractHostname,
  normalizeGitUrl,
} from "../../src/git/vendor-providers.js"

describe("vendor-providers utilities", () => {
  it("detectVendorFromUrl covers hosted vendors, strict GRASP URLs, relay URLs, and generic fallback", () => {
    expect(detectVendorFromUrl("https://github.com/a/b")).toBe("github")
    expect(detectVendorFromUrl("https://gitlab.example.com/a/b")).toBe("gitlab")
    expect(detectVendorFromUrl("https://gitea.example.org/a/b")).toBe("gitea")
    expect(detectVendorFromUrl("https://bitbucket.example.net/a/b")).toBe("bitbucket")
    expect(
      detectVendorFromUrl(
        "https://pyramid.fiatjaf.com/npub1elta7cneng3w8p9y4dw633qzdjr4kyvaparuyuttyrx6e8xp7xnq32cume/societybuilder.git",
      ),
    ).toBe("grasp-rest")
    expect(detectVendorFromUrl("wss://relay.example")).toBe("grasp-rest")
    expect(detectVendorFromUrl("https://unknown.example/a/b")).toBe("generic")
  })

  it("extractHostname handles ssh, https and invalid gracefully", () => {
    expect(extractHostname("git@github.com:owner/repo.git")).toBe("github.com")
    expect(extractHostname("https://gitlab.example.com/owner/repo")).toBe("gitlab.example.com")
    expect(extractHostname("not a url")).toBe("")
  })

  it("normalizeGitUrl converts ssh to https and appends .git when missing", () => {
    expect(normalizeGitUrl("git@github.com:owner/repo.git")).toBe(
      "https://github.com/owner/repo.git",
    )
    expect(normalizeGitUrl("https://example.com/owner/repo")).toBe(
      "https://example.com/owner/repo.git",
    )
    expect(normalizeGitUrl("https://example.com/owner/repo.git")).toBe(
      "https://example.com/owner/repo.git",
    )
  })
})
