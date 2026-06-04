import {beforeEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {COMMENT, MESSAGE, type TrustedEvent} from "@welshman/util"
import {
  canEditMessageEvent,
  canEditReplyEvent,
  areTagsEqual,
  editedTargetIds,
  filterVisibleAfterDeletesAndEdits,
  makeEditedMessageTemplate,
  makeEditedReplyTemplate,
  mergeRichEditorTags,
  suppressEventAfterEdit,
} from "./event-edits"

const {isDeleted} = vi.hoisted(() => ({isDeleted: vi.fn()}))

vi.mock("@welshman/app", () => ({
  repository: {isDeleted: (...args: unknown[]) => isDeleted(...args)},
}))

const pubkey = "a".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent> = {}): TrustedEvent =>
  ({
    id: "event-id",
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: COMMENT,
    tags: [],
    content: "old",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

describe("event edit helpers", () => {
  beforeEach(() => {
    isDeleted.mockReset()
    isDeleted.mockReturnValue(false)
    editedTargetIds.set(new Set())
  })

  it("allows recent own room messages and replies to be edited", () => {
    expect(canEditMessageEvent(makeEvent({kind: MESSAGE}), pubkey)).toBe(true)
    expect(canEditReplyEvent(makeEvent({kind: COMMENT}), pubkey)).toBe(true)
  })

  it("rejects edits for other authors, old events, wrong kinds, or missing publish access", () => {
    expect(canEditReplyEvent(makeEvent({pubkey: "b".repeat(64)}), pubkey)).toBe(false)
    expect(canEditReplyEvent(makeEvent({created_at: 1}), pubkey)).toBe(false)
    expect(canEditReplyEvent(makeEvent({kind: MESSAGE}), pubkey)).toBe(false)
    expect(canEditReplyEvent(makeEvent(), pubkey, false)).toBe(false)
  })

  it("preserves reply context while replacing content and editor tags", () => {
    const original = makeEvent({
      created_at: 123,
      tags: [
        ["h", "community"],
        ["E", "root", "wss://relay.example"],
        ["K", "11"],
        ["e", "parent"],
        ["k", "1111"],
        ["p", pubkey],
        ["f", "src/app.ts"],
        ["line", "12"],
        ["repo", "30617:pubkey:repo"],
        ["imeta", "url https://cdn.example/file.png"],
        ["-", "draft-only"],
      ],
    })

    expect(
      makeEditedReplyTemplate(original, {
        content: "new",
        tags: [
          ["t", "tag"],
          ["-", "x"],
        ],
      }),
    ).toEqual({
      content: "new",
      created_at: 123,
      tags: [
        ["h", "community"],
        ["E", "root", "wss://relay.example"],
        ["K", "11"],
        ["e", "parent"],
        ["k", "1111"],
        ["p", pubkey],
        ["f", "src/app.ts"],
        ["line", "12"],
        ["repo", "30617:pubkey:repo"],
        ["imeta", "url https://cdn.example/file.png"],
        ["t", "tag"],
      ],
    })
  })

  it("merges rich description tags while replacing simple repo context", () => {
    const current = makeEvent({
      tags: [
        ["a", "30617:owner:repo"],
        ["a", "30023:author:article", "wss://relay.example"],
        ["p", pubkey],
        ["imeta", "url https://cdn.example/old.png"],
        ["t", "bug"],
      ],
    })

    const merged = mergeRichEditorTags(
      current,
      [
        ["q", "event-id", "wss://relay.example"],
        ["-", "draft-only"],
      ],
      {repoAddress: "30617:owner:repo"},
    )

    expect(merged).toEqual([
      ["a", "30023:author:article", "wss://relay.example"],
      ["p", pubkey],
      ["imeta", "url https://cdn.example/old.png"],
      ["t", "bug"],
      ["q", "event-id", "wss://relay.example"],
    ])
    expect(areTagsEqual(merged, [...merged].reverse())).toBe(true)
  })

  it("preserves room message context while replacing content", () => {
    const original = makeEvent({
      kind: MESSAGE,
      created_at: 456,
      tags: [
        ["h", "community"],
        ["E", "room"],
        ["K", "11"],
        ["q", "parent"],
        ["p", pubkey],
      ],
    })

    expect(makeEditedMessageTemplate(original, {content: "edited", tags: [["t", "chat"]]})).toEqual(
      {
        content: "edited",
        created_at: 456,
        tags: [
          ["h", "community"],
          ["E", "room"],
          ["K", "11"],
          ["q", "parent"],
          ["t", "chat"],
        ],
      },
    )
  })

  it("filters locally suppressed and repository-deleted events", () => {
    const kept = makeEvent({id: "kept"})
    const suppressed = makeEvent({id: "suppressed"})
    const deleted = makeEvent({id: "deleted"})

    suppressEventAfterEdit(suppressed)
    isDeleted.mockImplementation(event => event.id === "deleted")

    expect(get(editedTargetIds)).toEqual(new Set(["suppressed"]))
    expect(
      filterVisibleAfterDeletesAndEdits([kept, suppressed, deleted]).map(event => event.id),
    ).toEqual(["kept"])
  })
})
