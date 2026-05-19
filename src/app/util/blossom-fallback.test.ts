import {describe, expect, it} from "vitest"
import {
  extractSha256FromUrl,
  getBlossomFallbackTargets,
  getBlossomFallbackUrls,
  getBlossomServersFromList,
} from "./blossom-fallback"

const hashA = "a".repeat(64)
const hashB = "b".repeat(64)

describe("blossom fallback helpers", () => {
  it("extracts the last lowercase sha256 hash from a media URL", () => {
    expect(extractSha256FromUrl(`https://cdn.example.com/${hashA}.jpg?mirror=${hashB}`)).toBe(hashB)
  })

  it("returns an empty hash when a URL has no lowercase sha256", () => {
    expect(extractSha256FromUrl(`https://cdn.example.com/${"A".repeat(64)}.jpg`)).toBe("")
    expect(extractSha256FromUrl("https://cdn.example.com/file.jpg")).toBe("")
  })

  it("builds ordered, deduped blossom fallback URLs", () => {
    expect(
      getBlossomFallbackUrls({
        hash: hashA,
        originalUrl: `https://origin.example.com/${hashA}`,
        originalServers: ["https://origin.example.com"],
        communityServers: ["https://community.example.com/", "bad-url"],
        authorServers: ["https://community.example.com", "https://author.example.com/path"],
      }),
    ).toEqual([`https://community.example.com/${hashA}`, `https://author.example.com/${hashA}`])
  })

  it("keeps an original-server no-extension fallback for extension URLs", () => {
    expect(
      getBlossomFallbackTargets({
        hash: hashA,
        originalUrl: `https://origin.example.com/${hashA}.png`,
        originalServers: ["https://origin.example.com"],
      }),
    ).toEqual([
      {
        server: "https://origin.example.com",
        source: "original",
        url: `https://origin.example.com/${hashA}`,
      },
    ])
  })

  it("extracts and normalizes blossom servers from list tags", () => {
    expect(
      getBlossomServersFromList({
        publicTags: [
          ["server", "https://blossom.example.com/"],
          ["server", "https://blossom.example.com"],
          ["server", "wss://legacy.example.com"],
        ],
      }),
    ).toEqual(["https://blossom.example.com", "https://legacy.example.com"])
  })
})
