import {describe, expect, it} from "vitest"
import {
  extractSha256FromUrl,
  getBlossomFallbackTargets,
  getBlossomFallbackUrls,
  getBlossomMirrorUrlsFromUploads,
  getBlossomServersFromList,
} from "./blossom-fallback"

const hashA = "a".repeat(64)
const hashB = "b".repeat(64)

describe("blossom fallback helpers", () => {
  it("extracts the lowercase sha256 hash from the media filename", () => {
    expect(extractSha256FromUrl(`https://cdn.example.com/${hashA}.jpg?mirror=${hashB}`)).toBe(hashA)
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

  it("prioritizes local mirror URLs before reconstructed servers", () => {
    expect(
      getBlossomFallbackTargets({
        hash: hashA,
        mirrorUrls: [`https://mirror.example.com/${hashA}.png`],
        mirrorServers: ["https://mirror-server.example.com"],
        communityServers: ["https://community.example.com"],
        lastResortServers: ["https://fallback.example.com"],
      }),
    ).toEqual([
      {server: "https://mirror.example.com", source: "mirror", url: `https://mirror.example.com/${hashA}.png`},
      {server: "https://mirror-server.example.com", source: "mirror", url: `https://mirror-server.example.com/${hashA}`},
      {server: "https://community.example.com", source: "community", url: `https://community.example.com/${hashA}`},
      {server: "https://fallback.example.com", source: "last-resort", url: `https://fallback.example.com/${hashA}`},
    ])
  })

  it("extracts successful local mirror URLs from dashboard uploads", () => {
    expect(
      getBlossomMirrorUrlsFromUploads({
        hash: hashA,
        uploads: [
          {
            id: "upload",
            createdAt: 1,
            updatedAt: 1,
            context: {type: "generic"},
            canonical: {url: `https://canonical.example.com/${hashA}.png`, sha256: hashA},
            optimizationMode: "auto",
            mirrorMode: "ask",
            mirrorJobs: [
              {
                id: "succeeded",
                targetUrl: "https://mirror.example.com",
                targetGroup: "manual",
                method: "server-mirror",
                status: "succeeded",
                attempts: 1,
                createdAt: 1,
                updatedAt: 1,
                resultUrl: `https://mirror.example.com/${hashA}.png`,
              },
              {
                id: "failed",
                targetUrl: "https://failed.example.com",
                targetGroup: "manual",
                method: "server-mirror",
                status: "failed",
                attempts: 1,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          },
        ],
      }),
    ).toEqual([
      `https://canonical.example.com/${hashA}.png`,
      `https://mirror.example.com/${hashA}.png`,
      `https://mirror.example.com/${hashA}`,
    ])
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
