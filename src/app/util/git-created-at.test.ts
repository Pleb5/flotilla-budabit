import {describe, expect, it} from "vitest"
import {getGitCreatedAt} from "./git-created-at"

describe("getGitCreatedAt", () => {
  it("uses the original creation date for imported items without changing the event timestamp", () => {
    const event = {
      created_at: 1_800_000_000,
      tags: [
        ["imported", ""],
        ["original_date", "1700000000"],
      ],
    }

    expect(getGitCreatedAt(event)).toBe(1_700_000_000)
    expect(event.created_at).toBe(1_800_000_000)
  })

  it("preserves the displayed date behavior even without an imported marker", () => {
    expect(getGitCreatedAt({created_at: 200, tags: [["original_date", "100"]]})).toBe(100)
  })

  it("uses the Nostr creation date for native items", () => {
    expect(getGitCreatedAt({created_at: 200, tags: [["subject", "Native issue"]]})).toBe(200)
  })

  it.each(["", " ", "invalid", "NaN", "Infinity", "-Infinity", "0", "-100"])(
    "falls back to the event timestamp for an invalid original_date: %j",
    originalDate => {
      expect(getGitCreatedAt({created_at: 200, tags: [["original_date", originalDate]]})).toBe(200)
    },
  )

  it("falls back when an original_date tag has no value", () => {
    expect(getGitCreatedAt({created_at: 200, tags: [["original_date"]]})).toBe(200)
  })
})
