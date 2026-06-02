import {describe, it, expect} from "vitest"
import type {RepoAnnouncementEvent} from "../../src/events/nip34/nip34.js"
import {createRepoAnnouncementEvent, getTagValue} from "../../src/events/nip34/nip34-utils.js"
import {groupByEuc, isMaintainer, deriveMaintainers} from "../../src/events/nip34/repositories.js"

function withMeta<T extends {pubkey?: string; id?: string; created_at?: number}>(
  evt: T,
  meta: {pubkey: string; id: string; created_at: number},
): T {
  return Object.assign(evt, meta)
}

describe("NIP-34 repositories: groupByEuc/isMaintainer/deriveMaintainers", () => {
  it("groupByEuc groups multiple repo announcements sharing the same EUC", () => {
    const euc = "euc-1"

    const a1 = withMeta(
      createRepoAnnouncementEvent({
        repoId: "alice/repo",
        clone: ["https://example.com/alice/repo.git"],
        maintainers: ["npub1maintainer", "invalid-pubkey"],
        earliestUniqueCommit: euc,
      }) as any as RepoAnnouncementEvent,
      {pubkey: "npub1alice", id: "a1", created_at: 1700000000},
    )

    const a2 = withMeta(
      createRepoAnnouncementEvent({
        repoId: "bob/repo",
        clone: ["https://example.com/bob/repo.git"],
        maintainers: ["npub1maintainer"],
        earliestUniqueCommit: euc,
      }) as any as RepoAnnouncementEvent,
      {pubkey: "npub1bob", id: "a2", created_at: 1700000001},
    )

    const groups = groupByEuc([a1, a2])
    expect(groups.length).toBe(1)

    const g = groups[0]
    expect(g.euc).toBe(euc)

    // Handles are d values (repo name segment from builder).
    expect(g.handles.sort()).toEqual(["repo", "repo"].sort())
    expect(g.clone.sort()).toEqual(
      ["https://example.com/alice/repo.git", "https://example.com/bob/repo.git"].sort(),
    )

    // Maintainers should include event pubkeys implicitly and filter invalid pubkeys.
    expect(g.maintainers).toEqual(
      expect.arrayContaining(["npub1maintainer", "npub1alice", "npub1bob"]),
    )
    expect(g.maintainers.some(m => m === "invalid-pubkey")).toBe(false)

    // Sanity check: d tag exists and can be read with helper.
    expect(getTagValue(a1 as any, "d")).toBe("repo")
  })

  it("isMaintainer checks membership and deriveMaintainers aggregates maintainers and authors", () => {
    const euc = "euc-2"

    const a1 = withMeta(
      createRepoAnnouncementEvent({
        repoId: "alice/repo",
        maintainers: ["npub1maintainer"],
        earliestUniqueCommit: euc,
      }) as any as RepoAnnouncementEvent,
      {pubkey: "npub1alice", id: "a1", created_at: 1700000100},
    )

    const [group] = groupByEuc([a1])
    expect(isMaintainer("npub1maintainer", group)).toBe(true)
    expect(isMaintainer("npub1notmaintainer", group)).toBe(false)

    const derived = deriveMaintainers(group)
    expect(Array.from(derived)).toEqual(expect.arrayContaining(["npub1maintainer", "npub1alice"]))
  })

  it("groupByEuc ignores events without an r:euc tag", () => {
    const a1 = withMeta(
      createRepoAnnouncementEvent({
        repoId: "alice/repo",
      }) as any as RepoAnnouncementEvent,
      {pubkey: "npub1alice", id: "a1", created_at: 1700000200},
    )

    const groups = groupByEuc([a1])
    expect(groups.length).toBe(0)
  })
})
