import {describe, expect, it} from "vitest"
import {isPersistedGitDeleteEvent} from "./storage-events"

describe("storage git delete persistence", () => {
  it("persists repo-scoped git delete events", () => {
    expect(
      isPersistedGitDeleteEvent({
        id: "delete-1",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [
          ["k", "1618"],
          ["e", "target-1"],
          ["repo", "30617:alice:repo"],
        ],
      } as any),
    ).toBe(true)
  })

  it("does not persist non-repo delete events", () => {
    expect(
      isPersistedGitDeleteEvent({
        id: "delete-2",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [
          ["k", "1"],
          ["e", "target-2"],
        ],
      } as any),
    ).toBe(false)
  })

  it("does not persist delete events without a git target kind", () => {
    expect(
      isPersistedGitDeleteEvent({
        id: "delete-3",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 5,
        created_at: 1,
        content: "",
        tags: [
          ["k", "1"],
          ["e", "target-3"],
          ["repo", "30617:alice:repo"],
        ],
      } as any),
    ).toBe(false)
  })
})
