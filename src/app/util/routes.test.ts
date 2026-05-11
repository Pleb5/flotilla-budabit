import {describe, expect, it, vi} from "vitest"
import {writable} from "svelte/store"
import * as nip19 from "nostr-tools/nip19"

vi.mock("$app/navigation", () => ({goto: vi.fn()}))

vi.mock("@app/core/state", () => ({
  makeChatId: (recipient: string) => recipient,
  entityLink: vi.fn(),
  decodeRelay: decodeURIComponent,
  DM_KIND: 4,
  encodeRelay: encodeURIComponent,
  PLATFORM_RELAYS: ["wss://relay.example.com"],
  isPlatformRelay: vi.fn(() => false),
  ROOM: "h",
}))

vi.mock("@app/util/history", () => ({lastPageBySpaceUrl: new Map()}))
vi.mock("@app/core/git-state", () => ({
  GIT_RELAYS: [],
  repoAnnouncementsByAddress: writable(new Map()),
}))
vi.mock("@lib/html", () => ({scrollToEvent: vi.fn()}))
vi.mock("@nostr-git/core/utils", () => ({buildRepoNaddrFromEvent: vi.fn()}))
vi.mock("@nostr-git/core/events", () => ({
  GIT_REPO_ANNOUNCEMENT: 30617,
  GIT_REPO_STATE: 30618,
  GIT_PULL_REQUEST: 1617,
  GIT_PULL_REQUEST_UPDATE: 1618,
  GIT_ISSUE: 1621,
  GIT_STATUS_OPEN: 1630,
  GIT_STATUS_APPLIED: 1631,
  GIT_STATUS_CLOSED: 1632,
  GIT_STATUS_DRAFT: 1633,
}))
vi.mock("@welshman/app", () => ({
  pubkey: {get: vi.fn()},
  tracker: {getRelays: vi.fn(() => [])},
  loadRelay: vi.fn(),
}))
vi.mock("@welshman/lib", () => ({
  identity: (value: unknown) => Boolean(value),
  nthEq: vi.fn(),
  sleep: vi.fn(),
}))
vi.mock("@welshman/router", () => ({
  Router: {get: () => ({FromUser: () => ({getUrls: () => []})})},
}))
vi.mock("@welshman/util", () => ({
  getTagValue: vi.fn(),
  MESSAGE: 9,
  THREAD: 11,
  ZAP_GOAL: 9041,
  EVENT_TIME: 31922,
  getPubkeyTagValues: vi.fn(() => []),
  Address: {fromEvent: vi.fn()},
  COMMENT: 1111,
  normalizeRelayUrl: (url: string) => (url.endsWith("/") ? url : `${url}/`),
  isRelayUrl: (url: string) => url.startsWith("wss://"),
}))

describe("routes", () => {
  const relayUrl = "wss://relay.damus.io"

  it("builds encoded space paths", async () => {
    const {makeSpacePath} = await import("./routes")

    expect(makeSpacePath(relayUrl)).toBe("/spaces/wss%3A%2F%2Frelay.damus.io")
    expect(makeSpacePath(relayUrl, "git", undefined, "naddr1abc")).toBe(
      "/spaces/wss%3A%2F%2Frelay.damus.io/git/naddr1abc",
    )
  })

  it("builds git paths from space paths", async () => {
    const {makeGitPath} = await import("./routes")

    expect(makeGitPath(relayUrl)).toBe("/spaces/wss%3A%2F%2Frelay.damus.io/git")
    expect(makeGitPath(relayUrl, "naddr1abc")).toBe(
      "/spaces/wss%3A%2F%2Frelay.damus.io/git/naddr1abc",
    )
  })

  it("builds git section paths", async () => {
    const {makeGitRepoPath, makeGitIssuePath, makeGitIssueCommentPath} = await import("./routes")

    expect(makeGitRepoPath(relayUrl, "naddr1xyz")).toBe(
      "/spaces/wss%3A%2F%2Frelay.damus.io/git/naddr1xyz/repos",
    )
    expect(makeGitIssuePath(relayUrl, "issue-id-1")).toBe(
      "/spaces/wss%3A%2F%2Frelay.damus.io/git/issue-id-1/issues",
    )
    expect(makeGitIssueCommentPath(relayUrl, "comment-id-1")).toBe(
      "/spaces/wss%3A%2F%2Frelay.damus.io/git/comment-id-1/issues/comments",
    )
  })

  it("builds and parses community paths", async () => {
    const {
      makeCommunityPath,
      makeCommunityRoomPath,
      makeCommunityThreadPath,
      parseCommunityRouteParam,
    } = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)

    expect(makeCommunityPath(communityPubkey)).toBe(`/c/${communityNpub}`)
    expect(makeCommunityRoomPath(communityPubkey, "room-id")).toBe(`/c/${communityNpub}/rooms/room-id`)
    expect(makeCommunityThreadPath(communityPubkey, "thread-id")).toBe(
      `/c/${communityNpub}/threads/thread-id`,
    )
    expect(parseCommunityRouteParam(communityNpub)).toEqual({
      pubkey: communityPubkey,
      relays: [],
      source: "npub",
    })
  })

  it("parses encoded ncommunity route params", async () => {
    const {parseCommunityRouteParam} = await import("./routes")
    const communityPubkey = "b".repeat(64)
    const value = `ncommunity://${communityPubkey}?relay=${encodeURIComponent(
      "wss://relay.example.com",
    )}`

    expect(parseCommunityRouteParam(encodeURIComponent(value))).toEqual({
      pubkey: communityPubkey,
      relays: ["wss://relay.example.com/"],
      source: "ncommunity",
    })
  })
})
