import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import type {PullRequestEvent} from "@nostr-git/core/events"
import {selectAuthorizedPullRequestUpdates} from "./pr-update-selection"

const author = "a".repeat(64)
const repoAddress = `30617:${"b".repeat(64)}:repo`

const makeRoot = (): PullRequestEvent =>
  ({
    id: "1".repeat(64),
    pubkey: author,
    created_at: 1,
    kind: 1618,
    tags: [
      ["a", repoAddress],
      ["c", "2".repeat(40)],
    ],
    content: "root",
    sig: "3".repeat(128),
  }) as PullRequestEvent

const makeUpdate = (overrides: Partial<TrustedEvent> = {}): TrustedEvent => ({
  id: "4".repeat(64),
  pubkey: author,
  created_at: 2,
  kind: 1619,
  tags: [
    ["a", repoAddress],
    ["E", makeRoot().id],
    ["P", author],
    ["c", "5".repeat(40)],
  ],
  content: "",
  sig: "6".repeat(128),
  ...overrides,
})

describe("authorized pull request updates", () => {
  it("accepts a valid visible update from the root author", () => {
    expect(selectAuthorizedPullRequestUpdates({root: makeRoot(), updates: [makeUpdate()]})).toEqual(
      [expect.objectContaining({tipCommitOid: "5".repeat(40)})],
    )
  })

  it.each([
    ["foreign author", {pubkey: "7".repeat(64)}],
    [
      "wrong root",
      {
        tags: [
          ["a", repoAddress],
          ["E", "8".repeat(64)],
          ["P", author],
          ["c", "5".repeat(40)],
        ],
      },
    ],
    [
      "wrong root author",
      {
        tags: [
          ["a", repoAddress],
          ["E", makeRoot().id],
          ["P", "9".repeat(64)],
          ["c", "5".repeat(40)],
        ],
      },
    ],
    [
      "wrong repository",
      {
        tags: [
          ["a", `30617:${"c".repeat(64)}:other`],
          ["E", makeRoot().id],
          ["P", author],
          ["c", "5".repeat(40)],
        ],
      },
    ],
    [
      "ambiguous tip",
      {
        tags: [
          ["a", repoAddress],
          ["E", makeRoot().id],
          ["P", author],
          ["c", "5".repeat(40)],
          ["c", "6".repeat(40)],
        ],
      },
    ],
    [
      "non-hex tip",
      {
        tags: [
          ["a", repoAddress],
          ["E", makeRoot().id],
          ["P", author],
          ["c", "not-an-oid"],
        ],
      },
    ],
    [
      "unsupported tip length",
      {
        tags: [
          ["a", repoAddress],
          ["E", makeRoot().id],
          ["P", author],
          ["c", "5".repeat(39)],
        ],
      },
    ],
    [
      "ambiguous root",
      {
        tags: [
          ["a", repoAddress],
          ["E", makeRoot().id],
          ["E", "8".repeat(64)],
          ["P", author],
          ["c", "5".repeat(40)],
        ],
      },
    ],
  ])("rejects %s", (_label, overrides) => {
    expect(
      selectAuthorizedPullRequestUpdates({root: makeRoot(), updates: [makeUpdate(overrides)]}),
    ).toEqual([])
  })

  it("excludes deleted updates before ordering", () => {
    const older = makeUpdate({id: "1".repeat(64), created_at: 2})
    const deletedLatest = makeUpdate({id: "2".repeat(64), created_at: 3})

    expect(
      selectAuthorizedPullRequestUpdates({
        root: makeRoot(),
        updates: [older, deletedLatest],
        isVisible: event => event.id !== deletedLatest.id,
      }).map(update => update.id),
    ).toEqual([older.id])
  })

  it("keeps the older valid update when a newer update has malformed Git OIDs", () => {
    const older = makeUpdate({id: "1".repeat(64), created_at: 2})
    const malformedLatest = makeUpdate({
      id: "2".repeat(64),
      created_at: 3,
      tags: [
        ["a", repoAddress],
        ["E", makeRoot().id],
        ["P", author],
        ["c", "6".repeat(40)],
        ["merge-base", "not-an-oid"],
      ],
    })

    expect(
      selectAuthorizedPullRequestUpdates({root: makeRoot(), updates: [older, malformedLatest]}).map(
        update => update.id,
      ),
    ).toEqual([older.id])
  })
})
