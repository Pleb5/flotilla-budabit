import {describe, expect, it} from "vitest"
import {getCommunitySectionNameKey, getSectionLifecycleChanges} from "./community-section-lifecycle"
import type {CommunityDefinitionSectionInput} from "./community"

const makeSection = (
  name: string,
  kinds: number[],
  originalNameKey?: string,
): CommunityDefinitionSectionInput & {originalNameKey?: string} => ({
  name,
  kinds: kinds.map(kind => ({kind})),
  profileLists: [],
  badges: [],
  retention: [],
  originalNameKey,
})

describe("community section lifecycle diff", () => {
  it("keys renamed sections by draft identity after a preceding removal shifts indexes", () => {
    const originalSections = [makeSection("Rooms", [11]), makeSection("Threads", [1111])]
    const currentSections = [
      makeSection("Discussion", [1111], getCommunitySectionNameKey("Threads")),
    ]

    expect(getSectionLifecycleChanges({originalSections, currentSections})).toEqual([
      {type: "rename", oldSectionName: "Threads", newSectionName: "Discussion"},
      {type: "remove", oldSectionName: "Rooms"},
    ])
  })

  it("reports removed, moved, and renamed section changes without index matching", () => {
    const originalSections = [makeSection("Rooms", [11]), makeSection("Threads", [1111])]
    const currentSections = [
      makeSection("Discussion", [11, 1111], getCommunitySectionNameKey("Threads")),
    ]

    expect(getSectionLifecycleChanges({originalSections, currentSections})).toEqual([
      {type: "rename", oldSectionName: "Threads", newSectionName: "Discussion"},
      {type: "remove", oldSectionName: "Rooms"},
      {
        type: "move",
        kindKey: "11:",
        kindLabel: "11",
        oldSectionName: "Rooms",
        newSectionName: "Discussion",
      },
    ])
  })
})
