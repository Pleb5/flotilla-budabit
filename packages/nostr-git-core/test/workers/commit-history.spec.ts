import {describe, expect, it} from "vitest"
import {buildCommitHistoryRefsToTry} from "../../src/worker/workers/commit-history.js"

describe("buildCommitHistoryRefsToTry", () => {
  it("prefers the requested branch before HEAD", () => {
    expect(buildCommitHistoryRefsToTry("feature").slice(0, 5)).toEqual([
      "feature",
      "origin/feature",
      "refs/remotes/origin/feature",
      "refs/heads/feature",
      "HEAD",
    ])
  })

  it("keeps HEAD first when no branch is requested", () => {
    expect(buildCommitHistoryRefsToTry().slice(0, 5)).toEqual([
      "HEAD",
      "main",
      "origin/main",
      "refs/remotes/origin/main",
      "refs/heads/main",
    ])
  })

  it("does not duplicate fallback refs for the requested branch", () => {
    const refs = buildCommitHistoryRefsToTry("main")

    expect(refs.filter(ref => ref === "main")).toHaveLength(1)
    expect(refs.filter(ref => ref === "origin/main")).toHaveLength(1)
    expect(refs.filter(ref => ref === "refs/remotes/origin/main")).toHaveLength(1)
    expect(refs.filter(ref => ref === "refs/heads/main")).toHaveLength(1)
  })
})
