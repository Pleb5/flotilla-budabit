import {afterEach, describe, expect, it, vi} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  buildGitHubIdentityUpdate,
  createGitHubAttestation,
  githubProofText,
  normalizeGitHubIdentity,
  normalizeWebsite,
  parseNip05,
  readGitHubIdentity,
  replaceGitHubTags,
  selectIdentityEvent,
  verifyGitHubGist,
  verifyGitHubIdentity,
  verifyNip05,
} from "./profile-identity"

const pubkey = "ab".repeat(32)
const identity = {username: "alice", proof: "abc123"}
const event = (tags: string[][], kind = 0, created_at = 1, id = "a") =>
  ({kind, tags, created_at, id, pubkey, content: "", sig: ""}) as TrustedEvent
const gist = () => ({
  id: identity.proof,
  public: true,
  owner: {login: "Alice"},
  files: {"nostr.txt": {content: githubProofText(pubkey)}},
})
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status})

afterEach(() => vi.unstubAllGlobals())

describe("profile identity metadata", () => {
  it("loads legacy tags, including extended tags and pasted Gist URLs", () => {
    expect(
      readGitHubIdentity({
        event: event([["i", "github:Alice", "https://gist.github.com/Alice/abc123", "future"]]),
      }),
    ).toEqual(identity)
  })
  it("prefers dedicated NIP-39 events, including explicit removal, over legacy tags", () => {
    const profile = {event: event([["i", "github:alice", "abc123"]])}
    expect(readGitHubIdentity(profile, event([["i", "github:bob", "def456"]], 10011))).toEqual({
      username: "bob",
      proof: "def456",
    })
    expect(readGitHubIdentity(profile, event([], 10011))).toEqual({username: "", proof: ""})
  })
  it("selects the current author's latest identity event deterministically", () => {
    const newest = event([], 10011, 3, "a")
    expect(
      selectIdentityEvent(
        [
          event([], 10011, 2),
          event([], 10011, 3, "b"),
          {...event([], 10011, 4), pubkey: "cd".repeat(32)},
          newest,
        ],
        pubkey,
      ),
    ).toBe(newest)
  })
  it("preserves unrelated profile tags and other platform proofs when replacing/removing GitHub", () => {
    const tags = [
      ["i", "github:old", "123"],
      ["i", "twitter:alice", "456"],
      ["custom", "keep"],
    ]
    expect(replaceGitHubTags(tags, identity)).toEqual([
      tags[1],
      tags[2],
      ["i", "github:alice", "abc123"],
    ])
    expect(replaceGitHubTags(tags, {username: "", proof: ""})).toEqual([tags[1], tags[2]])
    expect(tags).toHaveLength(3)
    expect(() => replaceGitHubTags(tags, {username: "alice", proof: ""})).toThrow()
  })
  it("carries edits into legacy and modern publication without losing other identities", () => {
    const profile = {
      event: event([
        ["custom", "keep"],
        ["i", "github:old", "123"],
      ]),
    }
    const current = event(
      [
        ["i", "github:old", "123"],
        ["i", "mastodon:example.com/@alice", "789"],
      ],
      10011,
    )
    const result = buildGitHubIdentityUpdate(profile, identity, current)
    expect(result.profileTags).toEqual([
      ["custom", "keep"],
      ["i", "github:alice", "abc123"],
    ])
    expect(result.identityTags).toEqual([
      ["i", "mastodon:example.com/@alice", "789"],
      ["i", "github:alice", "abc123"],
    ])
    expect(buildGitHubIdentityUpdate(profile, undefined, current).profileTags).toBe(
      profile.event.tags,
    )
  })
  it("does not republish unchanged identities and does publish an explicit removal", () => {
    const profile = {event: event([["i", "github:alice", "abc123"]])}
    expect(buildGitHubIdentityUpdate(profile, identity).identityTags).toBeUndefined()
    expect(buildGitHubIdentityUpdate(profile, {username: "", proof: ""}).identityTags).toEqual([])
  })
  it("does not block unrelated edits to a malformed existing claim", () => {
    const profile = {event: event([["i", "github:alice", "not-a-gist"]])}
    expect(buildGitHubIdentityUpdate(profile, {username: "alice", proof: "not-a-gist"})).toEqual({
      profileTags: profile.event.tags,
    })
  })
  it("normalizes only matching Gist URLs and prevents unsafe website schemes", () => {
    expect(
      normalizeGitHubIdentity({
        username: " @Alice ",
        proof: "https://gist.github.com/alice/abc123#file-nostr",
      }),
    ).toEqual(identity)
    expect(
      normalizeGitHubIdentity({username: "alice", proof: "https://gist.github.com/bob/abc123"})
        .proof,
    ).toContain("https:")
    expect(normalizeWebsite("example.com/path")).toBe("https://example.com/path")
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,test",
      "ftp://example.com",
      "https://user:pass@example.com",
    ])
      expect(normalizeWebsite(url)).toBe("")
  })
})

describe("NIP-05 validation", () => {
  it("accepts identifiers and domain-only names, rejecting URLs and malformed addresses", () => {
    expect(parseNip05(" Alice@Example.com ")).toEqual({name: "Alice", domain: "example.com"})
    expect(parseNip05("example.com")).toEqual({name: "_", domain: "example.com"})
    for (const value of ["https://example.com", "a@@example.com", "a@localhost", "a@-example.com"])
      expect(parseNip05(value)).toBeUndefined()
  })
  it("checks the address against the actual profile key, not just the presence of a record", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({names: {alice: pubkey}}))
      .mockResolvedValueOnce(response({names: {alice: "cd".repeat(32)}}))
    vi.stubGlobal("fetch", fetch)
    expect((await verifyNip05("alice@example.com", pubkey)).status).toBe("valid")
    expect((await verifyNip05("alice@example.com", pubkey)).status).toBe("invalid")
    expect(fetch.mock.calls[0][0]).toBe("https://example.com/.well-known/nostr.json?name=alice")
    expect(fetch.mock.calls[0][1].redirect).toBe("error")
  })
  it("distinguishes unavailable services from invalid proofs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("CORS")))
    expect((await verifyNip05("alice@example.com", pubkey)).status).toBe("unavailable")
  })
})

describe("GitHub proof verification and automation", () => {
  it("verifies gist owner, visibility, exact key text and file count", () => {
    expect(verifyGitHubGist(gist(), identity, pubkey).status).toBe("valid")
    for (const invalid of [
      {...gist(), owner: {login: "mallory"}},
      {...gist(), public: false},
      {...gist(), id: "999"},
      {...gist(), files: {"nostr.txt": {content: githubProofText("cd".repeat(32))}}},
      {...gist(), files: {...gist().files, extra: {content: "anything"}}},
      {...gist(), files: {"nostr.txt": {content: githubProofText(pubkey), truncated: true}}},
    ])
      expect(verifyGitHubGist(invalid, identity, pubkey).status).toBe("invalid")
  })
  it("distinguishes missing gists from API rate limits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response({}, 404)).mockResolvedValueOnce(response({}, 403)),
    )
    expect((await verifyGitHubIdentity(identity, pubkey)).status).toBe("invalid")
    expect((await verifyGitHubIdentity(identity, pubkey)).status).toBe("unavailable")
  })
  it("reuses an existing matching proof without creating a duplicate", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({login: "Alice"}))
      .mockResolvedValueOnce(response([gist()]))
      .mockResolvedValueOnce(response(gist()))
    vi.stubGlobal("fetch", fetch)
    expect(await createGitHubAttestation("test-token", pubkey)).toEqual(identity)
    expect(fetch.mock.calls.every(([, options]) => options.method === "GET")).toBe(true)
  })
  it("creates a public gist only when requested and returns the checked proof", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({login: "Alice"}))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response(gist()))
    vi.stubGlobal("fetch", fetch)
    expect(await createGitHubAttestation("test-token", pubkey)).toEqual(identity)
    const [url, options] = fetch.mock.calls[2]
    expect(url).toBe("https://api.github.com/gists")
    expect(options.method).toBe("POST")
    expect(JSON.parse(options.body)).toMatchObject({
      public: true,
      files: {"nostr-verification.txt": {content: githubProofText(pubkey)}},
    })
    expect(fetch.mock.calls.every(([url]) => url.startsWith("https://api.github.com/"))).toBe(true)
  })
  it("gives actionable errors and never creates a gist after token or list failures", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({}, 401))
    vi.stubGlobal("fetch", fetch)
    await expect(createGitHubAttestation("test-token", pubkey)).rejects.toThrow(
      "expired or invalid",
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
