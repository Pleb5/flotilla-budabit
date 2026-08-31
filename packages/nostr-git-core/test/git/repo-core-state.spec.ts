import {describe, expect, it} from "vitest"
import {RepoCore, type RepoContext} from "../../src/git/repo-core.js"
import type {RepoStateEvent} from "../../src/events/index.js"

const owner = "a".repeat(64)
const maintainer = "b".repeat(64)
const foreign = "c".repeat(64)

const context: RepoContext = {
  repoEvent: {
    id: "1".repeat(64),
    pubkey: owner,
    created_at: 1,
    kind: 30617,
    tags: [["d", "repo"], ["maintainers", maintainer]],
    content: "",
    sig: "2".repeat(128),
  },
  repo: {owner, repoId: "repo"},
}

const state = ({
  id,
  pubkey,
  created_at,
  repoId = "repo",
}: {
  id: string
  pubkey: string
  created_at: number
  repoId?: string
}): RepoStateEvent =>
  ({
    id,
    pubkey,
    created_at,
    kind: 30618,
    tags: [["d", repoId], ["refs/heads/main", "3".repeat(40)]],
    content: "",
    sig: "4".repeat(128),
  }) as RepoStateEvent

describe("authorized repository state selection", () => {
  it("accepts a newer direct-maintainer state and ignores foreign or wrong-repo states", () => {
    const ownerState = state({id: "9".repeat(64), pubkey: owner, created_at: 2})
    const maintainerState = state({id: "8".repeat(64), pubkey: maintainer, created_at: 3})
    const foreignState = state({id: "7".repeat(64), pubkey: foreign, created_at: 4})
    const wrongRepo = state({
      id: "6".repeat(64),
      pubkey: maintainer,
      created_at: 5,
      repoId: "other",
    })

    expect(
      RepoCore.selectAuthorizedRepoStateEvent(context, [
        ownerState,
        maintainerState,
        foreignState,
        wrongRepo,
      ]),
    ).toBe(maintainerState)
  })

  it("uses the lower event id for equal replaceable-event timestamps", () => {
    const higherId = state({id: "f".repeat(64), pubkey: owner, created_at: 3})
    const lowerId = state({id: "0".repeat(64), pubkey: maintainer, created_at: 3})

    expect(RepoCore.selectAuthorizedRepoStateEvent(context, [higherId, lowerId])).toBe(lowerId)
  })
})
