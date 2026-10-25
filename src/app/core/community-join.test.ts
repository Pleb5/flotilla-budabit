import {describe, expect, it} from "vitest"
import {readCommunityJoinEntry, setCommunityJoinEntry} from "./community-join"
import {
  buildCommunityDefinition,
  parseCommunityDefinition,
  updateCommunityDefinition,
} from "./community-protocol"
import {finalizeEvent} from "nostr-tools"

describe("default community join entry", () => {
  const tags = [
    ["d", "community"],
    ["content", "General"],
    ["join"],
    ["k", "1111"],
    ["x-future", "keep"],
    ["content", "Other"],
    ["k", "7"],
  ]
  it("uses the containing block, never kind count or display-name guessing", () => {
    expect(readCommunityJoinEntry(tags)).toEqual({status: "selected", sectionName: "General"})
    expect(readCommunityJoinEntry(setCommunityJoinEntry(tags, "Other"))).toEqual({
      status: "selected",
      sectionName: "Other",
    })
    expect(
      readCommunityJoinEntry([
        ["content", "General"],
        ["k", "1111"],
      ]),
    ).toEqual({status: "absent"})
  })
  it("fails closed on duplicate, misplaced and malformed markers", () => {
    for (const value of [
      [...tags, ["join"]],
      [["join"], ...tags.slice(0, 2)],
      [
        ["content", "General"],
        ["join", "General"],
      ],
    ])
      expect(readCommunityJoinEntry(value)).toEqual({status: "invalid"})
  })
  it("replaces all old markers after a merge and retains unrelated extensions", () => {
    const changed = setCommunityJoinEntry([...tags, ["join"]], "Other")
    expect(changed.filter(t => t[0] === "join")).toHaveLength(1)
    expect(changed).toContainEqual(["x-future", "keep"])
    expect(readCommunityJoinEntry(setCommunityJoinEntry(changed, null))).toEqual({status: "absent"})
    expect(() => setCommunityJoinEntry(tags, "Missing")).toThrow()
  })
  it("roundtrips through the real parser and editor across rename, reorder and removal", () => {
    const communityId = "a".repeat(64)
    const params = {
      communityId,
      name: "Fixture",
      relays: ["wss://fixture.example"],
      sections: [
        {name: "General", kinds: [{kind: 1111}], profileLists: []},
        {name: "Other", kinds: [{kind: 7}], profileLists: []},
      ],
    }
    const template = buildCommunityDefinition(params)
    const event = finalizeEvent(
      {
        ...template,
        tags: [...setCommunityJoinEntry(template.tags, "General"), ["future", "retain"]],
        created_at: 1,
      },
      new Uint8Array(32).fill(30),
    )
    const definition = parseCommunityDefinition(event)!
    expect(definition).toBeDefined()
    expect(
      readCommunityJoinEntry(
        updateCommunityDefinition(definition, {name: "Renamed community"}).tags,
      ).status,
    ).toBe("selected")
    const renamed = updateCommunityDefinition(
      definition,
      {},
      {
        replacement: buildCommunityDefinition({
          ...params,
          sections: [params.sections[1], {...params.sections[0], name: "Welcome"}],
        }),
        originalSectionNames: {welcome: "general"},
      },
    )
    expect(readCommunityJoinEntry(renamed.tags)).toEqual({
      status: "selected",
      sectionName: "Welcome",
    })
    expect(renamed.tags).toContainEqual(["future", "retain"])
    const removed = updateCommunityDefinition(
      definition,
      {},
      {replacement: buildCommunityDefinition({...params, sections: [params.sections[1]]})},
    )
    expect(readCommunityJoinEntry(removed.tags)).toEqual({status: "absent"})
    const invalid = {...event, tags: [...event.tags, ["join"]]}
    expect(parseCommunityDefinition(invalid)).toBeDefined()
    expect(readCommunityJoinEntry(invalid.tags)).toEqual({status: "invalid"})
  })
})
