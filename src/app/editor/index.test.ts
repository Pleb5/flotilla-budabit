import {describe, expect, it} from "vitest"
import {plainTextToTiptapHTML} from "./text"

describe("plainTextToTiptapHTML", () => {
  it("keeps plain-text line breaks when initializing Tiptap HTML", () => {
    expect(plainTextToTiptapHTML("deployed new version:\n\n- Work\n- Menu & nav")).toBe(
      "<p>deployed new version:</p><p></p><p>- Work<br>- Menu &amp; nav</p>",
    )
  })
})
