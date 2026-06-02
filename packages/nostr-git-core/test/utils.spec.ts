import {describe, it, expect} from "vitest"
import {getTag, getTags, getTagValue} from "../src/events/nip34/nip34-utils.js"
import type {NostrTag} from "../src/events/nip34/nip34.js"

function makeEvent(tags: NostrTag[]) {
  return {tags} as {tags: NostrTag[]}
}

describe("tag helpers", () => {
  it("getTagValue returns undefined when tag missing", () => {
    const ev = makeEvent([["x", "y"]])
    expect(getTagValue(ev, "a")).toBeUndefined()
  })

  it("getTag returns the first matching tag when duplicates exist", () => {
    const ev = makeEvent([
      ["t", "first"],
      ["t", "second"],
    ])
    const tag = getTag(ev, "t")
    expect(tag).toBeDefined()
    expect(tag?.[1]).toBe("first")
  })

  it("getTags returns all matching tags preserving order", () => {
    const ev = makeEvent([
      ["t", "one"],
      ["t", "two"],
      ["x", "noop"],
      ["t", "three"],
    ])
    const tags = getTags(ev, "t")
    expect(tags.map(t => t[1])).toEqual(["one", "two", "three"])
  })

  it("handles multi-value tags like clone", () => {
    const ev = makeEvent([
      ["clone", "https://a.git", "git@b:repo.git"],
      ["clone", "https://c.git"],
    ])
    const tags = getTags(ev, "clone")
    expect(tags.length).toBe(2)
    expect(tags[0]).toEqual(["clone", "https://a.git", "git@b:repo.git"])
    expect(tags[1]).toEqual(["clone", "https://c.git"])
  })

  it("getTagValue returns undefined for malformed single-key tag with no value", () => {
    const ev = makeEvent([
      // malformed, but should not throw
      ["clone"] as unknown as NostrTag,
    ])
    expect(getTagValue(ev, "clone")).toBeUndefined()
  })
})
