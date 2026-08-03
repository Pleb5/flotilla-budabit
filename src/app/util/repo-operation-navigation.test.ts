import {describe, expect, it, vi} from "vitest"

import {isSameRepoCoordinate, waitForRepoNavigation} from "./repo-operation-navigation"

describe("repository operation navigation", () => {
  it("recognizes only an exact owner and identifier match", () => {
    expect(
      isSameRepoCoordinate({
        currentOwner: "owner",
        currentIdentifier: "repo",
        nextOwner: "owner",
        nextIdentifier: "repo",
      }),
    ).toBe(true)
    expect(
      isSameRepoCoordinate({
        currentOwner: "owner",
        currentIdentifier: "repo",
        nextOwner: "other",
        nextIdentifier: "repo",
      }),
    ).toBe(false)
    expect(
      isSameRepoCoordinate({
        currentOwner: "owner",
        currentIdentifier: "repo",
        nextOwner: "owner",
        nextIdentifier: "renamed",
      }),
    ).toBe(false)
  })

  it("waits for successful direct navigation", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined)

    await expect(waitForRepoNavigation(navigate, 100)).resolves.toBeUndefined()
    expect(navigate).toHaveBeenCalledOnce()
  })

  it("bounds a stalled navigation", async () => {
    vi.useFakeTimers()
    try {
      const navigation = waitForRepoNavigation(() => new Promise(() => {}), 100)
      const expectation = expect(navigation).rejects.toThrow(
        "Repository navigation timed out after 1s",
      )
      await vi.advanceTimersByTimeAsync(100)
      await expectation
    } finally {
      vi.useRealTimers()
    }
  })

  it("reports a navigation that succeeds after the bounded wait", async () => {
    vi.useFakeTimers()
    try {
      let finishNavigation!: () => void
      const onLateSuccess = vi.fn()
      const navigation = waitForRepoNavigation(
        () =>
          new Promise<void>(resolve => {
            finishNavigation = resolve
          }),
        100,
        onLateSuccess,
      )
      const expectation = expect(navigation).rejects.toThrow(
        "Repository navigation timed out after 1s",
      )

      await vi.advanceTimersByTimeAsync(100)
      await expectation
      finishNavigation()
      await Promise.resolve()

      expect(onLateSuccess).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
