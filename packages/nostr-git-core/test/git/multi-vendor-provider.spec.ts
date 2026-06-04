import {describe, it, expect, vi, beforeEach} from "vitest"
import "fake-indexeddb/auto"

import {MultiVendorGitProvider} from "../../src/git/multi-vendor-git-provider.js"

vi.mock("../../src/git/vendor-provider-factory.js", () => {
  const mkMeta = (
    ownerLogin: string,
    name: string,
  ): import("../../src/git/vendor-providers.js").RepoMetadata => ({
    id: `${ownerLogin}/${name}`,
    name,
    fullName: `${ownerLogin}/${name}`,
    description: "",
    defaultBranch: "main",
    isPrivate: false,
    cloneUrl: `https://example.com/${ownerLogin}/${name}.git`,
    htmlUrl: `https://example.com/${ownerLogin}/${name}`,
    owner: {login: ownerLogin, type: "User"},
  })
  return {
    parseRepoFromUrl: (url: string) => {
      if (!url.includes("://")) return null
      const u = new URL(url)
      return {
        provider: {
          hostname: u.hostname,
          getRepoMetadata: vi.fn(async (owner: string, repo: string) => mkMeta(owner, repo)),
          createRepo: vi.fn(async (name: string) => mkMeta("me", name)),
          updateRepo: vi.fn(async (owner: string, repo: string) => mkMeta(owner, repo)),
          forkRepo: vi.fn(async (owner: string, _repo: string, forkName: string) =>
            mkMeta(owner, forkName),
          ),
        },
        owner: "o",
        repo: "r",
      }
    },
    resolveVendorProvider: (url: string) => {
      const u = new URL(url.startsWith("http") ? url : `https://${url}`)
      return {
        hostname: u.hostname,
        createRepo: vi.fn(async (name: string) => mkMeta("me", name)),
      }
    },
  }
})

vi.mock("../../src/git/factory.js", () => ({createGitProvider: () => ({})}))

describe("MultiVendorGitProvider (strict)", () => {
  let m: MultiVendorGitProvider
  beforeEach(() => {
    m = new MultiVendorGitProvider()
  })

  it("getRepoMetadata throws on invalid URL", async () => {
    await expect(m.getRepoMetadata("not-a-url")).rejects.toThrow(/Unable to parse repository URL/)
  })

  it("getRepoMetadata allows anonymous provider reads", async () => {
    const meta = await m.getRepoMetadata("https://github.com/o/r")
    expect(meta.owner.login).toBe("o")
    expect(meta.name).toBe("r")
  })

  it("createRemoteRepo without token throws auth required", async () => {
    await expect(
      m.createRemoteRepo("x", {targetHost: "gitlab.example.com", isPrivate: false}),
    ).rejects.toThrow(/auth/i)
  })

  it("setTokens enables createRemoteRepo", async () => {
    m.setTokens([{host: "gitlab.example.com", token: "t"}])
    const meta = await m.createRemoteRepo("proj", {
      targetHost: "gitlab.example.com",
      isPrivate: false,
    })
    expect(meta.name).toBe("proj")
  })

  it("updateRemoteRepo without token throws auth required", async () => {
    await expect(m.updateRemoteRepo("https://github.com/o/r", {description: "d"})).rejects.toThrow(
      /auth/i,
    )
  })

  it("updateRemoteRepo works with token", async () => {
    m.setTokens([{host: "github.com", token: "t"}])
    const meta = await m.updateRemoteRepo("https://github.com/o/r", {description: "d"})
    expect(meta.owner.login).toBe("o")
    expect(meta.name).toBe("r")
  })

  it("forkRemoteRepo requires token and returns fork meta", async () => {
    m.setTokens([{host: "github.com", token: "t"}])
    const meta = await m.forkRemoteRepo("https://github.com/o/r", "forked")
    expect(meta.name).toBe("forked")
  })
})
