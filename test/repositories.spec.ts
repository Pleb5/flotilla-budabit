import {describe, it, expect} from "vitest"
import {groupByEuc, isMaintainer} from "../src/events/nip34/repositories.js"
import {type RepoAnnouncementEvent} from "../src/events/nip34/nip34.js"

function repoEvt(
  tags: string[][],
  override: Partial<RepoAnnouncementEvent> = {},
): RepoAnnouncementEvent {
  return {
    id: "x",
    kind: 30617,
    pubkey: "p",
    created_at: 0,
    content: "",
    tags: tags as any,
    sig: "s",
    ...override,
  } as unknown as RepoAnnouncementEvent
}

describe("repositories grouping & maintainers", () => {
  it("groups by r:euc and unions handles, links, relays, maintainers", () => {
    const euc = "abcdef"
    const r1 = repoEvt([
      ["r", euc, "euc"],
      ["d", "alice/repo"],
      ["web", "https://example.com"],
      ["clone", "git+https://example.com/alice/repo.git"],
      ["relays", "wss://relay.one"],
      ["maintainers", "npub1alice", "npub1bob"],
    ])
    const r2 = repoEvt([
      ["r", euc, "euc"],
      ["d", "alice/repo"], // duplicate handle in same group should dedupe
      ["web", "https://example.com/docs"],
      ["clone", "git+ssh://example.com/alice/repo.git"],
      ["relays", "wss://relay.two"],
      ["maintainers", "npub1bob", "npub1carol"],
    ])

    const groups = groupByEuc([r1, r2])
    expect(groups).toHaveLength(1)
    const g = groups[0]
    expect(g.euc).toBe(euc)
    expect(g.repos.length).toBe(2)
    expect(g.handles.sort()).toEqual(["alice/repo"])
    expect(g.web.sort()).toEqual(["https://example.com", "https://example.com/docs"])
    expect(g.clone.length).toBe(2)
    expect(g.relays.sort()).toEqual(["wss://relay.one", "wss://relay.two"])
    expect(g.maintainers.sort()).toEqual(["npub1alice", "npub1bob", "npub1carol"].sort())

    expect(isMaintainer("npub1alice", g)).toBe(true)
    expect(isMaintainer("npub1nobody", g)).toBe(false)
  })

  it("ignores repos without r:euc tag", () => {
    const r = repoEvt([["d", "no/euc"]])
    const groups = groupByEuc([r])
    expect(groups).toHaveLength(0)
  })
})
