import {beforeEach, describe, it, expect, vi} from "vitest"
import {nip19} from "nostr-tools"
import type {RepoAnnouncementEvent} from "../../src/events/index.js"
import {rootDir} from "../../src/git/git.js"
import {getRepoStorageKey} from "../../src/git/repo-storage-key.js"

const listBranches = vi.hoisted(() => vi.fn())

// Mock getGitProvider to control branch listing
vi.mock("../../src/api/git-provider.js", () => ({
  getGitProvider: () => ({
    listBranches,
  }),
}))

const {listBranchesFromEvent} = await import("../../src/git/branches.js")

const owner = "a".repeat(64)
const announcement = (
  identifier = "stable-id",
  name = "My Great Repo",
  clone?: string,
): RepoAnnouncementEvent => ({
  id: "fixture",
  sig: "fixture-only",
  kind: 30617,
  pubkey: owner,
  created_at: 1,
  content: "",
  tags: [["d", identifier], ["name", name], ...(clone ? [["clone", clone]] : [])],
})

describe("git/branches: listBranchesFromEvent", () => {
  beforeEach(() => {
    listBranches
      .mockReset()
      .mockImplementation(async args => (args.remote === "origin" ? ["origin/feature"] : ["main"]))
  })
  it("merges local and remote branches and strips origin/ prefix", async () => {
    const branches = await listBranchesFromEvent({repoEvent: announcement()})
    const names = branches.map((b: any) => b.name).sort()
    expect(names).toEqual(["feature", "main"])
    expect(listBranches.mock.calls.map(([args]) => args.dir)).toEqual([
      `${rootDir}/${owner}/stable-id`,
      `${rootDir}/${owner}/stable-id`,
    ])
  })
  it.each(["stable-id", "Legacy.Case"])(
    "finds the same %s clone before and after a display rename",
    async identifier => {
      for (const name of ["My Great Repo", "名前 with spaces!"]) {
        await listBranchesFromEvent({repoEvent: announcement(identifier, name)})
      }
      expect(new Set(listBranches.mock.calls.map(([args]) => args.dir))).toEqual(
        new Set([`${rootDir}/${owner}/${identifier}`]),
      )
    },
  )
  it("keeps equal display names in separate identifier namespaces", async () => {
    await listBranchesFromEvent({repoEvent: announcement("first")})
    await listBranchesFromEvent({repoEvent: announcement("second")})
    expect(new Set(listBranches.mock.calls.map(([args]) => args.dir))).toEqual(
      new Set([`${rootDir}/${owner}/first`, `${rootDir}/${owner}/second`]),
    )
  })
  it("retains the shared GRASP npub owner convention", async () => {
    const npub = nip19.npubEncode(owner)
    const event = announcement(
      "stable-id",
      "My Great Repo",
      `https://git.example/${npub}/stable-id.git`,
    )
    expect(getRepoStorageKey(event)).toBe(`${npub}/stable-id`)
    await listBranchesFromEvent({repoEvent: event})
    expect(listBranches).toHaveBeenCalledWith({dir: `${rootDir}/${npub}/stable-id`})
  })
  it("never substitutes a display name for a missing identifier", async () => {
    const event = announcement()
    event.tags = event.tags.filter(tag => tag[0] !== "d")
    await expect(listBranchesFromEvent({repoEvent: event})).rejects.toThrow()
    expect(listBranches).not.toHaveBeenCalled()
  })
})
