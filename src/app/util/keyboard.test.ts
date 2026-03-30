// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"

describe("keyboard", () => {
  it("syncKeyboard returns noop cleanup", async () => {
    const {syncKeyboard} = await import("./keyboard")
    const cleanup = syncKeyboard()

    expect(cleanup).toBeDefined()
    expect(typeof cleanup).toBe("function")
    expect(() => cleanup()).not.toThrow()
  })
})
