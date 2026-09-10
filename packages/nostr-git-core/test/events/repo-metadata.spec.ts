import {describe, expect, it} from "vitest"
import {
  editRepoAnnouncementEvent,
  editRepoStateHead,
  getForkUpstreamTags,
  getRepoUpstreamTags,
  validateRepoUpstream,
} from "../../src/events/nip34/repo-metadata.js"
import {
  createRepoAnnouncementEvent,
  createRepoStateEvent,
  parseRepoAnnouncementEvent,
} from "../../src/events/nip34/nip34-utils.js"
import type {RepoAnnouncementEvent} from "../../src/events/nip34/nip34.js"

const owner = "a".repeat(64)
const upstream = `30617:${"b".repeat(64)}:Parent/Case:Sensitive`
const source: RepoAnnouncementEvent = {
  id: "old",
  sig: "signed",
  pubkey: owner,
  kind: 30617,
  created_at: 100,
  content: "Preserve me",
  tags: [
    ["d", "Legacy/Case:ID"],
    ["name", "Old name"],
    ["r", "1".repeat(40), "euc"],
    ["clone", "https://git.test/owner/Legacy.git"],
    ["maintainers", "c".repeat(64)],
    ["u", upstream, "wss://source.test", "hint"],
    ["u", "https://git.test/parent.git", "other"],
    ["r", "other-index", "future"],
    ["future-tag", "", "opaque"],
  ],
}

describe("owner-anchored metadata", () => {
  it("edits only name, preserving coordinate, content, EUC and unknown fields", () => {
    const snapshot = structuredClone(source)
    const edited = editRepoAnnouncementEvent(source, {name: "名前 with spaces!"}, 101)
    expect(edited.tags.filter(tag => tag[0] !== "name")).toEqual(
      source.tags.filter(tag => tag[0] !== "name"),
    )
    expect(edited.tags.filter(tag => tag[0] === "name")).toEqual([["name", "名前 with spaces!"]])
    expect(edited.pubkey).toBe(owner)
    expect(edited.content).toBe(source.content)
    expect(edited.id).toBeUndefined()
    expect(edited.sig).toBeUndefined()
    expect(parseRepoAnnouncementEvent(edited).address).toBe(`30617:${owner}:Legacy/Case:ID`)
    expect(source).toEqual(snapshot)
  })
  it("adds a name to legacy metadata without re-slugging d", () => {
    const legacy = {...source, tags: source.tags.filter(tag => tag[0] !== "name")}
    expect(editRepoAnnouncementEvent(legacy, {name: "Readable"}).tags).toContainEqual([
      "d",
      "Legacy/Case:ID",
    ])
    expect(
      createRepoAnnouncementEvent({
        repoId: "unused/key",
        identifier: "Legacy/Case:ID",
        name: "Readable",
      }).tags,
    ).toContainEqual(["d", "Legacy/Case:ID"])
  })
  it("supports multiple upstream hints and explicit removal without changing authority", () => {
    expect(parseRepoAnnouncementEvent(source).upstreams).toEqual(getRepoUpstreamTags(source))
    const edited = editRepoAnnouncementEvent(source, {upstreams: []})
    expect(getRepoUpstreamTags(edited)).toEqual([])
    expect(edited.tags.find(tag => tag[0] === "maintainers")).toEqual(
      source.tags.find(tag => tag[0] === "maintainers"),
    )
    expect(edited.tags.find(tag => tag[0] === "r")).toEqual(source.tags.find(tag => tag[0] === "r"))
  })
  it("points forks at the immediate source and preserves upstreams when adding hosting", () => {
    expect(getForkUpstreamTags(source, "https://unused.test/repo.git")).toEqual([
      ["u", `30617:${owner}:Legacy/Case:ID`],
    ])
    expect(getForkUpstreamTags(undefined, "https://git.test/source.git")).toEqual([
      ["u", "https://git.test/source.git"],
    ])
    expect(
      getRepoUpstreamTags(
        editRepoAnnouncementEvent(source, {clone: ["https://new.test/repo.git"]}),
      ),
    ).toEqual(getRepoUpstreamTags(source))
  })
  it("rejects self upstreams and unsafe links", () => {
    expect(validateRepoUpstream(upstream, upstream)).toMatch(/own upstream/)
    expect(validateRepoUpstream("javascript:alert(1)")).toBeTruthy()
    expect(validateRepoUpstream(upstream)).toBeUndefined()
    expect(validateRepoUpstream("git@git.test:owner/source.git")).toBeUndefined()
    expect(validateRepoUpstream("https://user:password@git.test/source.git")).toBeTruthy()
  })
  it("preserves refs/ancestry on an intentional HEAD edit without a new state schema", () => {
    const state = createRepoStateEvent({
      repoId: "unused",
      identifier: "Legacy/Case:ID",
      head: "main",
      refs: [
        {type: "heads", name: "main", commit: "1".repeat(40)},
        {type: "heads", name: "next", commit: "2".repeat(40), ancestry: ["1".repeat(40)]},
      ],
    })
    const edited = editRepoStateHead(state, "Legacy/Case:ID", "next", owner, 101)
    expect(edited.tags.filter(tag => tag[0] !== "HEAD")).toEqual(
      state.tags.filter(tag => tag[0] !== "HEAD"),
    )
    expect(edited.tags).toContainEqual(["HEAD", "ref: refs/heads/next"])
    expect(edited.tags.some(tag => tag[0] === "a")).toBe(false)
    expect(() => editRepoStateHead(state, "Legacy/Case:ID", "absent", owner, 101)).toThrow(
      /must exist/,
    )
    expect(() => editRepoStateHead(undefined, "Legacy/Case:ID", "next", owner, 101)).toThrow(
      /unavailable/,
    )
  })
})
