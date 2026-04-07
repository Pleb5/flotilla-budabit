import * as nip19 from "nostr-tools/nip19"
import {describe, expect, it} from "vitest"
import {GIT_ISSUE, GIT_PATCH, GIT_PULL_REQUEST, GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"
import {getCommentRootQuoteValue, getGitQuoteFallback, getTrimmedReplyPreview} from "./git-quote"

const pubkey = "a".repeat(64)
const sig = "b".repeat(128)

describe("getGitQuoteFallback", () => {
  it("returns the repository name for repo shares", () => {
    expect(
      getGitQuoteFallback({
        id: "repo",
        kind: GIT_REPO_ANNOUNCEMENT,
        pubkey,
        created_at: 0,
        content: "",
        sig,
        tags: [["name", "budabit"]],
      } as any),
    ).toBe("budabit")
  })

  it("returns the issue subject for issue shares", () => {
    expect(
      getGitQuoteFallback({
        id: "issue",
        kind: GIT_ISSUE,
        pubkey,
        created_at: 0,
        content: "",
        sig,
        tags: [["subject", "Fix reply previews"]],
      } as any),
    ).toBe("Fix reply previews")
  })

  it("returns the pull request subject for pr shares", () => {
    expect(
      getGitQuoteFallback({
        id: "pr",
        kind: GIT_PULL_REQUEST,
        pubkey,
        created_at: 0,
        content: "",
        sig,
        tags: [["subject", "Ship quote fallback"]],
      } as any),
    ).toBe("Ship quote fallback")
  })

  it("returns a generic permalink label for permalinks", () => {
    expect(
      getGitQuoteFallback({
        id: "link",
        kind: 1623,
        pubkey,
        created_at: 0,
        content: "const value = 1",
        sig,
        tags: [],
      } as any),
    ).toBe("permalink")
  })

  it("returns the patch subject for patches", () => {
    expect(
      getGitQuoteFallback({
        id: "patch",
        kind: GIT_PATCH,
        pubkey,
        created_at: 0,
        content: "",
        sig,
        tags: [["subject", "Refine fallback rendering"]],
      } as any),
    ).toBe("Refine fallback rendering")
  })

  it("returns an empty string for non-git events", () => {
    expect(
      getGitQuoteFallback({
        id: "note",
        kind: 1,
        pubkey,
        created_at: 0,
        content: "hello",
        sig,
        tags: [],
      } as any),
    ).toBe("")
  })
})

describe("reply preview helpers", () => {
  it("strips a leading quoted event before previewing reply text", () => {
    const quoted = `nostr:${nip19.neventEncode({id: "c".repeat(64), relays: ["wss://relay.example.com"]})}`

    expect(
      getTrimmedReplyPreview({
        content: `${quoted}\n\nLooks good to me`,
        tags: [],
      } as any),
    ).toBe("Looks good to me")
  })

  it("returns an empty preview when the content is only a quote", () => {
    const quoted = `nostr:${nip19.neventEncode({id: "d".repeat(64), relays: ["wss://relay.example.com"]})}`

    expect(
      getTrimmedReplyPreview({
        content: `${quoted}\n\n`,
        tags: [],
      } as any),
    ).toBe("")
  })

  it("extracts a root event reference from git comments", () => {
    expect(
      getCommentRootQuoteValue({
        id: "comment",
        kind: 1111,
        pubkey,
        created_at: 0,
        content: "ship it",
        sig,
        tags: [
          ["E", "e".repeat(64)],
          ["K", "1623"],
          ["R", "wss://relay.example.com"],
        ],
      } as any),
    ).toEqual({id: "e".repeat(64), relays: ["wss://relay.example.com"]})
  })

  it("extracts a root address reference from repo comments", () => {
    expect(
      getCommentRootQuoteValue({
        id: "comment",
        kind: 1111,
        pubkey,
        created_at: 0,
        content: "repo note",
        sig,
        tags: [["A", `30617:${pubkey}:budabit`]],
      } as any),
    ).toEqual({identifier: "budabit", kind: 30617, pubkey, relays: []})
  })
})
