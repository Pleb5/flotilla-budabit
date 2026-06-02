import {describe, it, expect} from "vitest"

import {
  getGitServiceApi,
  getGitServiceApiFromUrl,
  getAvailableProviders,
  supportsRestApi,
  getDefaultApiBaseUrl,
} from "../../src/git/provider-factory.js"

// These tests exercise lightweight branches and error paths without performing network calls

describe("git/provider-factory", () => {
  it("getAvailableProviders lists supported providers", () => {
    expect(getAvailableProviders()).toEqual([
      "github",
      "gitlab",
      "gitea",
      "bitbucket",
      "grasp",
      "grasp-rest",
    ])
  })

  it("supportsRestApi returns true for known providers", () => {
    for (const p of ["github", "gitlab", "gitea", "bitbucket", "grasp", "grasp-rest"] as const) {
      expect(supportsRestApi(p)).toBe(true)
    }
  })

  it("getDefaultApiBaseUrl returns URLs and throws on providers requiring custom base", () => {
    expect(getDefaultApiBaseUrl("github")).toBe("https://api.github.com")
    expect(getDefaultApiBaseUrl("gitlab")).toBe("https://gitlab.com/api/v4")
    expect(getDefaultApiBaseUrl("bitbucket")).toBe("https://api.bitbucket.org/2.0")

    expect(() => getDefaultApiBaseUrl("gitea")).toThrow(/requires a custom base URL/i)
    expect(() => getDefaultApiBaseUrl("grasp")).toThrow(/requires a custom relay URL/i)
    expect(() => getDefaultApiBaseUrl("grasp-rest")).toThrow(/requires a custom relay URL/i)
    expect(() => getDefaultApiBaseUrl("generic" as any)).toThrow(
      /Generic provider does not have a default/i,
    )
  })

  it("getGitServiceApiFromUrl detects providers from URL", () => {
    // GitHub
    expect(() => getGitServiceApiFromUrl("https://github.com/owner/repo", "t")).not.toThrow()
    // GitLab SaaS
    expect(() => getGitServiceApiFromUrl("https://gitlab.com/owner/repo", "t")).not.toThrow()
    // GitLab self-hosted
    expect(() =>
      getGitServiceApiFromUrl("https://gitlab.example.com/owner/repo", "t"),
    ).not.toThrow()
    // Gitea self-hosted
    expect(() => getGitServiceApiFromUrl("https://gitea.example.com/owner/repo", "t")).not.toThrow()
    // Bitbucket
    expect(() => getGitServiceApiFromUrl("https://bitbucket.org/owner/repo", "t")).not.toThrow()
    // GRASP (ws)
    expect(() => getGitServiceApiFromUrl("wss://relay.example.com", "pubkey")).not.toThrow()
    // Unknown
    expect(() => getGitServiceApiFromUrl("https://unknown.example.com/x/y", "t")).toThrow(
      /Unable to detect Git provider/i,
    )
  })

  it("getGitServiceApi throws when GRASP baseUrl is missing and for generic/unknown", () => {
    expect(() => getGitServiceApi("grasp", "pub", undefined as any)).toThrow(
      /requires a relay URL/i,
    )
    expect(() => getGitServiceApi("generic" as any, "t")).toThrow(/does not support REST API/i)
    expect(() => getGitServiceApi("nope" as any, "t")).toThrow(/Unknown Git provider/i)
  })
})
