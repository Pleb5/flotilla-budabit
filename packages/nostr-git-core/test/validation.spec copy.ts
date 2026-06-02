import {describe, it, expect} from "vitest"
import {assertValidTags, safeParseEventTags, NostrTagSchema} from "../src/validation.js"

describe("runtime validation", () => {
  it("assertValidTags passes for valid tags", () => {
    const event = {
      tags: [
        ["e", "abc"],
        ["p", "pubkey"],
      ],
    }
    expect(() => assertValidTags(event)).not.toThrow()
  })

  it("assertValidTags throws for invalid tags", () => {
    const event = {tags: [["e"], ["p", 123] as any]}
    expect(() => assertValidTags(event as any)).toThrowError()
  })

  it("safeParseEventTags returns success for valid tags", () => {
    const event = {tags: [["t", "topic", "extra"]]}
    const res = safeParseEventTags(event)
    expect(res.success).toBe(true)
  })

  it("NostrTagSchema validates tuple of strings", () => {
    const ok = NostrTagSchema.safeParse(["clone", "https://git", "ssh://git"]).success
    expect(ok).toBe(true)
  })
})
