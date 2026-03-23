import {describe, expect, it, vi} from "vitest"

vi.mock("@app/util/routes", () => ({
  makeSpacePath: (url: string, ...extra: (string | undefined)[]) =>
    `/spaces/${encodeURIComponent(url)}/${extra.filter(Boolean).join("/")}`,
}))

import {
  makeJobPath,
  makeGitPath,
  makeGitRepoPath,
  makeGitIssuePath,
  makeGitIssueCommentPath,
} from "./routes"

describe("budabit routes", () => {
  const relayUrl = "wss://relay.damus.io"

  describe("makeJobPath", () => {
    it("delegates to makeSpacePath with jobs segment", () => {
      expect(makeJobPath(relayUrl)).toContain("/jobs")
      expect(makeJobPath(relayUrl, "evt123")).toContain("/jobs/evt123")
    })
  })

  describe("makeGitPath", () => {
    it("delegates to makeSpacePath with git segment", () => {
      expect(makeGitPath(relayUrl)).toContain("/git")
      expect(makeGitPath(relayUrl, "naddr1abc")).toContain("/git/naddr1abc")
    })
  })

  describe("makeGitRepoPath", () => {
    it("delegates to makeSpacePath with git and repos segments", () => {
      expect(makeGitRepoPath(relayUrl)).toContain("/git")
      expect(makeGitRepoPath(relayUrl)).toContain("/repos")
      expect(makeGitRepoPath(relayUrl, "naddr1xyz")).toContain("/git/naddr1xyz/repos")
    })
  })

  describe("makeGitIssuePath", () => {
    it("delegates to makeSpacePath with git and issues segments", () => {
      expect(makeGitIssuePath(relayUrl)).toContain("/git")
      expect(makeGitIssuePath(relayUrl)).toContain("/issues")
      expect(makeGitIssuePath(relayUrl, "issue-id-1")).toContain("/git/issue-id-1/issues")
    })
  })

  describe("makeGitIssueCommentPath", () => {
    it("delegates to makeSpacePath with git, issues, and comments segments", () => {
      expect(makeGitIssueCommentPath(relayUrl)).toContain("/git")
      expect(makeGitIssueCommentPath(relayUrl)).toContain("/issues")
      expect(makeGitIssueCommentPath(relayUrl)).toContain("/comments")
      expect(makeGitIssueCommentPath(relayUrl, "comment-id-1")).toContain(
        "/git/comment-id-1/issues/comments",
      )
    })
  })
})
