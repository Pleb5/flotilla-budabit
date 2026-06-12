import {describe, expect, it} from "vitest"
import {
  defaultRepoWatchOptions,
  defaultRepoWatchState,
  normalizeRepoWatchOptions,
  normalizeRepoWatchState,
} from "./repo-watch"

describe("repo-watch normalization", () => {
  it("fills missing option values with defaults", () => {
    const options = normalizeRepoWatchOptions({
      issues: {comments: true},
      prs: {updates: false},
      status: {closed: false},
      assignments: false,
    })

    expect(options).toEqual({
      issues: {new: true, comments: true},
      prs: {new: true, comments: false, updates: false},
      status: {open: true, draft: true, applied: true, closed: false},
      assignments: false,
      reviews: false,
      activityFilter: "all",
    })
  })

  it("returns defaults for empty inputs", () => {
    expect(normalizeRepoWatchOptions()).toEqual(defaultRepoWatchOptions)
    expect(normalizeRepoWatchState()).toEqual(defaultRepoWatchState)
  })

  it("normalizes repo watch state per repo", () => {
    const state = normalizeRepoWatchState({
      repos: {
        "30617:alice:repo": {
          issues: {new: false},
          prs: {comments: true},
          status: {draft: false, applied: false},
          reviews: false,
          activityFilter: "maintainers",
        },
      },
      notificationSeen: {
        "/git/example/issues": 1_700_000_000_000,
        "/git/example/prs": 1_700_000_001,
        invalid: -1,
      },
    })

    expect(state.repos["30617:alice:repo"]).toEqual({
      issues: {new: false, comments: false},
      prs: {new: true, comments: true, updates: true},
      status: {open: true, draft: false, applied: false, closed: true},
      assignments: true,
      reviews: false,
      activityFilter: "maintainers",
    })
    expect(state.notificationSeen).toEqual({
      "/git/example/issues": 1_700_000_000,
      "/git/example/prs": 1_700_000_001,
    })
  })

  it("normalizes unknown activity filters to all activity", () => {
    expect(normalizeRepoWatchOptions({activityFilter: "unknown"}).activityFilter).toBe("all")
  })

  it("migrates legacy patch watch options to PR options", () => {
    const options = normalizeRepoWatchOptions({
      patches: {new: false, comments: true, updates: false},
    })

    expect(options.prs).toEqual({new: false, comments: true, updates: false})
  })
})
