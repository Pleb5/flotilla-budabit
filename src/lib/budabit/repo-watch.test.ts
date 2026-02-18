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
      patches: {updates: false},
      status: {closed: false},
      assignments: false,
    })

    expect(options).toEqual({
      issues: {new: true, comments: true},
      patches: {new: true, comments: false, updates: false},
      status: {open: true, draft: true, applied: true, closed: false},
      assignments: false,
      reviews: true,
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
          patches: {comments: true},
          status: {draft: false, applied: false},
          reviews: false,
        },
      },
    })

    expect(state.repos["30617:alice:repo"]).toEqual({
      issues: {new: false, comments: false},
      patches: {new: true, comments: true, updates: true},
      status: {open: true, draft: false, applied: false, closed: true},
      assignments: true,
      reviews: false,
    })
  })
})
