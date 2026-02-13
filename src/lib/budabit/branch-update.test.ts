import {describe, it, expect} from "vitest"
import {
  diffBranchHeads,
  buildBranchUpdateDedupeKey,
  overlayLatestRepoStates,
  type BranchChange,
} from "./branch-update"

describe("branch-update helpers", () => {
  it("detects added, updated, and removed heads", () => {
    const current = new Map<string, string>([
      ["refs/heads/main", "aaa111"],
      ["refs/heads/old", "bbb222"],
    ])
    const remote = new Map<string, string>([
      ["refs/heads/main", "ccc333"],
      ["refs/heads/new", "ddd444"],
    ])

    const changes = diffBranchHeads(current, remote).sort((a, b) => a.name.localeCompare(b.name))

    expect(changes).toEqual<BranchChange[]>([
      {name: "main", oldOid: "aaa111", newOid: "ccc333", change: "updated"},
      {name: "new", newOid: "ddd444", change: "added"},
      {name: "old", oldOid: "bbb222", change: "removed"},
    ])
  })

  it("builds a stable dedupe key regardless of repo/update order", () => {
    const a = buildBranchUpdateDedupeKey([
      {
        repoId: "repo-b",
        updates: [{name: "master", change: "updated", oldOid: "1", newOid: "2"}],
      },
      {
        repoId: "repo-a",
        updates: [
          {name: "main", change: "updated", oldOid: "x", newOid: "y"},
          {name: "dev", change: "added", newOid: "z"},
        ],
      },
    ])

    const b = buildBranchUpdateDedupeKey([
      {
        repoId: "repo-a",
        updates: [
          {name: "dev", change: "added", newOid: "z"},
          {name: "main", change: "updated", oldOid: "x", newOid: "y"},
        ],
      },
      {
        repoId: "repo-b",
        updates: [{name: "master", change: "updated", oldOid: "1", newOid: "2"}],
      },
    ])

    expect(a).toBe(b)
    expect(a).toContain("repo-a:")
    expect(a).toContain("repo-b:")
  })

  it("overlays optimistic repo state when it is newer", () => {
    const base = new Map<string, {id: string; created_at: number}>([
      ["neovim-flake", {id: "old", created_at: 100}],
    ])
    const optimistic = {
      "neovim-flake": {id: "new", created_at: 200},
    }

    const merged = overlayLatestRepoStates(base, optimistic)
    expect(merged.get("neovim-flake")?.id).toBe("new")
  })

  it("keeps subscribed repo state when it is newer than optimistic", () => {
    const base = new Map<string, {id: string; created_at: number}>([
      ["neovim-flake", {id: "newer", created_at: 300}],
    ])
    const optimistic = {
      "neovim-flake": {id: "older", created_at: 200},
    }

    const merged = overlayLatestRepoStates(base, optimistic)
    expect(merged.get("neovim-flake")?.id).toBe("newer")
  })
})
