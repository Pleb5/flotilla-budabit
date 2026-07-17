import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  COMMIT_COMMENT_KIND,
  getCommitCommentFilters,
  getCommitCommentRoot,
  isCommitCommentForRepo,
} from "./commit-comments"

const makeComment = (tags: string[][]): TrustedEvent =>
  ({
    id: "comment-id",
    kind: 1111,
    pubkey: "author",
    created_at: 1,
    content: "Comment",
    tags,
    sig: "",
  }) as TrustedEvent

describe("commit comment scoping", () => {
  const oid = "ABCDEF0123456789"
  const repoAddress = "30617:owner:repo"

  it("normalizes the git object id used as the external root", () => {
    expect(getCommitCommentRoot(` ${oid} `)).toBe("git:commit:abcdef0123456789")
  })

  it("builds a relay filter scoped to the commit and repository", () => {
    expect(getCommitCommentFilters({oid, repoAddress})).toEqual([
      {
        kinds: [1111],
        "#I": ["git:commit:abcdef0123456789"],
        "#q": [repoAddress],
      },
    ])
  })

  it("accepts legacy top-level comments without lowercase parent tags", () => {
    const event = makeComment([
      ["I", getCommitCommentRoot(oid)],
      ["K", COMMIT_COMMENT_KIND],
      ["q", repoAddress],
    ])

    expect(isCommitCommentForRepo(event, {oid, repoAddress})).toBe(true)
  })

  it("rejects comments for another repository or external kind", () => {
    const wrongRepo = makeComment([
      ["I", getCommitCommentRoot(oid)],
      ["K", COMMIT_COMMENT_KIND],
      ["q", "30617:owner:fork"],
    ])
    const wrongKind = makeComment([
      ["I", getCommitCommentRoot(oid)],
      ["K", "url"],
      ["q", repoAddress],
    ])

    expect(isCommitCommentForRepo(wrongRepo, {oid, repoAddress})).toBe(false)
    expect(isCommitCommentForRepo(wrongKind, {oid, repoAddress})).toBe(false)
  })
})
