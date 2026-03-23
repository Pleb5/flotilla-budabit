// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"

const mockAddListener = vi.fn().mockResolvedValue({remove: vi.fn()})

vi.mock("@capacitor/core", () => ({
  Capacitor: {isNativePlatform: vi.fn(() => false)},
}))

vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    addListener: mockAddListener,
  },
}))

describe("keyboard", () => {
  it("syncKeyboard returns noop when not native platform", async () => {
    const {syncKeyboard} = await import("./keyboard")
    const cleanup = syncKeyboard()

    expect(cleanup).toBeDefined()
    expect(typeof cleanup).toBe("function")
    expect(mockAddListener).not.toHaveBeenCalled()
  })

  it("syncKeyboard adds listeners and returns cleanup when native", async () => {
    const {Capacitor} = await import("@capacitor/core")
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)

    const {syncKeyboard} = await import("./keyboard")
    const cleanup = syncKeyboard()

    expect(mockAddListener).toHaveBeenCalledWith("keyboardWillShow", expect.any(Function))
    expect(mockAddListener).toHaveBeenCalledWith("keyboardWillHide", expect.any(Function))
    expect(typeof cleanup).toBe("function")
    expect(() => cleanup()).not.toThrow()
  })
})
