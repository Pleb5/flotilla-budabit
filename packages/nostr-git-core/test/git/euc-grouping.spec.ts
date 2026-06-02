import {describe, it, expect} from "vitest"
import {groupByEuc} from "../../src/events/nip34/repositories.js"

function mkEvt(overrides: Partial<any> = {}) {
  return {
    kind: 30617,
    pubkey: "npub1maint",
    created_at: 1,
    content: "",
    id: "evt",
    sig: "sig",
    tags: [
      ["r", "wss://relay.example/euc-123", "euc"],
      ["d", "owner/repo"],
      ["web", "https://site"],
      ["clone", "https://git"],
      ["maintainers", "npub1maint"],
    ],
    ...overrides,
  } as any
}

describe("groupByEuc", () => {
  it("groups announcements by r:euc and unions facets", () => {
    const a = mkEvt()
    const b = mkEvt({
      tags: [
        ["r", "wss://relay.example/euc-123", "euc"],
        ["d", "owner/repo2"],
        ["web", "https://site2"],
        ["clone", "https://git2"],
        ["maintainers", "npub1maint", "npub1other"],
      ],
    })

    const groups = groupByEuc([a, b])
    expect(groups.length).toBe(1)
    const g = groups[0]
    expect(g.euc).toBe("wss://relay.example/euc-123")
    expect(g.handles).toContain("owner/repo")
    expect(g.handles).toContain("owner/repo2")
    expect(g.web).toContain("https://site")
    expect(g.clone).toContain("https://git2")
    expect(g.maintainers).toContain("npub1maint")
    expect(g.maintainers).toContain("npub1other")
  })
})
