// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"

vi.mock("@lib/html", () => ({
  copyToClipboard: vi.fn(),
}))

describe("toast", () => {
  afterEach(async () => {
    const {toast} = await import("./toast")
    toast.set([])
  })

  describe("pushToast", () => {
    it("adds toast to store", async () => {
      const {pushToast, toast} = await import("./toast")

      const id = pushToast({message: "Test message"})

      expect(id).toBeDefined()
      const list = get(toast)
      expect(list).toHaveLength(1)
      expect(list[0].message).toBe("Test message")
      expect(list[0].id).toBe(id)
    })

    it("limits to MAX_TOASTS", async () => {
      const {pushToast, toast} = await import("./toast")

      for (let i = 0; i < 5; i++) {
        pushToast({message: `Toast ${i}`})
      }

      const list = get(toast)
      expect(list.length).toBeLessThanOrEqual(3)
    })
  })

  describe("popToast", () => {
    it("removes toast by id", async () => {
      const {pushToast, popToast, toast} = await import("./toast")

      const id = pushToast({message: "To remove"})
      expect(get(toast)).toHaveLength(1)

      popToast(id)
      expect(get(toast)).toHaveLength(0)
    })
  })

  describe("clip", () => {
    it("calls copyToClipboard and pushToast", async () => {
      const {copyToClipboard} = await import("@lib/html")
      const {clip, toast} = await import("./toast")

      clip("copied value")

      expect(copyToClipboard).toHaveBeenCalledWith("copied value")
      const list = get(toast)
      expect(list.some(t => t.message?.includes("Copied"))).toBe(true)
    })
  })
})
