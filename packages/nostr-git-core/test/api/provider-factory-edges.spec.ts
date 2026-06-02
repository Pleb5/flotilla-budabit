import {describe, it, expect} from "vitest"
import "fake-indexeddb/auto"

import {
  getGitServiceApiFromUrl,
  getDefaultApiBaseUrl,
  getGitServiceApi,
  supportsRestApi,
  getAvailableProviders,
} from "../../src/git/provider-factory.js"

const GRASP_REPO_URL =
  "https://relay.example.com/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/repo.git"

describe("provider-factory edge cases", () => {
  it("ssh-like URL with unknown host cannot be detected and throws", () => {
    expect(() => getGitServiceApiFromUrl("git@unknown.local:owner/repo.git", "t")).toThrow(
      /Unable to detect Git provider/,
    )
  })

  it("getDefaultApiBaseUrl throws for gitea/grasp/generic and unknown provider", () => {
    expect(() => getDefaultApiBaseUrl("gitea")).toThrow(/Gitea requires a custom base URL/)
    expect(() => getDefaultApiBaseUrl("grasp" as any)).toThrow(
      /GRASP provider requires a custom relay URL/,
    )
    expect(() => getDefaultApiBaseUrl("generic")).toThrow(
      /Generic provider does not have a default API base URL/,
    )
    expect(() => getDefaultApiBaseUrl("unknown" as any)).toThrow(/Unknown provider/)
  })

  it("getGitServiceApi throws for generic provider", () => {
    expect(() => getGitServiceApi("generic", "t")).toThrow(/Generic Git provider does not support/)
  })

  it("getGitServiceApi grasp without baseUrl throws", () => {
    expect(() => getGitServiceApi("grasp", "npub")).toThrow(/GRASP provider requires a relay URL/)
  })

  it("supportsRestApi true for all supported providers", () => {
    for (const p of ["github", "gitlab", "gitea", "bitbucket", "grasp"] as const) {
      expect(supportsRestApi(p)).toBe(true)
    }
  })

  it("getAvailableProviders contains all supported providers", () => {
    const ps = getAvailableProviders()
    expect(ps).toEqual(expect.arrayContaining(["github", "gitlab", "gitea", "bitbucket", "grasp"]))
  })

  it("self-hosted gitlab detection succeeds", () => {
    // Should not throw and return an API instance
    const api = getGitServiceApiFromUrl("https://gitlab.example.com/owner/repo", "t")
    expect(api).toBeTruthy()
  })

  it("gitlab.com detection succeeds", () => {
    const api = getGitServiceApiFromUrl("https://gitlab.com/owner/repo", "t")
    expect(api).toBeTruthy()
  })

  it("grasp relay detection from ws URL succeeds", () => {
    const api = getGitServiceApiFromUrl("wss://relay.example.com", "npub")
    expect(api).toBeTruthy()
    expect((api as any).baseUrl).toBe("https://relay.example.com")
  })

  it("grasp clone URLs normalize to the HTTP origin for grasp-rest", () => {
    const api = getGitServiceApiFromUrl(GRASP_REPO_URL, "npub")
    expect(api).toBeTruthy()
    expect((api as any).baseUrl).toBe("https://relay.example.com")
  })

  it("direct grasp-rest construction normalizes relay URLs to HTTP base URLs", () => {
    const api = getGitServiceApi("grasp-rest", "npub", "wss://relay.example.com")
    expect((api as any).baseUrl).toBe("https://relay.example.com")
  })

  it("supportsRestApi returns false for generic", () => {
    expect(supportsRestApi("generic" as any)).toBe(false)
  })

  it("getDefaultApiBaseUrl returns known URLs for github/gitlab/bitbucket", () => {
    expect(getDefaultApiBaseUrl("github")).toBe("https://api.github.com")
    expect(getDefaultApiBaseUrl("gitlab")).toBe("https://gitlab.com/api/v4")
    expect(getDefaultApiBaseUrl("bitbucket")).toBe("https://api.bitbucket.org/2.0")
  })

  it("github.com detection succeeds", () => {
    const api = getGitServiceApiFromUrl("https://github.com/octo/repo", "t")
    expect(api).toBeTruthy()
  })

  it("bitbucket.org detection succeeds", () => {
    const api = getGitServiceApiFromUrl("https://bitbucket.org/team/repo", "t")
    expect(api).toBeTruthy()
  })

  it("gitea self-hosted detection succeeds", () => {
    const api = getGitServiceApiFromUrl("https://gitea.example.com/owner/repo", "t")
    expect(api).toBeTruthy()
  })

  it("bitbucket self-hosted detection succeeds (bitbucket.*)", () => {
    const api = getGitServiceApiFromUrl("https://bitbucket.example.com/owner/repo", "t")
    expect(api).toBeTruthy()
  })

  it("getGitServiceApi unknown provider throws", () => {
    expect(() => getGitServiceApi("unknown" as any, "t")).toThrow(/Unknown Git provider/)
  })

  it("unknown http host throws when provider cannot be inferred", () => {
    expect(() => getGitServiceApiFromUrl("https://unknown.local/owner/repo", "t")).toThrow(
      /Unable to detect Git provider/,
    )
  })
})
