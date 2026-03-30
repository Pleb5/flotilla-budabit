import {describe, expect, it} from "vitest"
import {
  toNaturalLabel,
  normalizeEffectiveLabels,
  toNaturalArray,
  extractRoleAssignments,
  groupLabels,
  buildRoleLabelEvent,
  ROLE_NS,
} from "./labels"

describe("labels", () => {
  describe("toNaturalLabel", () => {
    it("returns empty string for non-string input", () => {
      expect(toNaturalLabel(null as any)).toBe("")
      expect(toNaturalLabel(undefined as any)).toBe("")
      expect(toNaturalLabel(123 as any)).toBe("")
    })

    it("returns empty string for empty or whitespace-only input", () => {
      expect(toNaturalLabel("")).toBe("")
      expect(toNaturalLabel("   ")).toBe("")
    })

    it("strips leading # from labels", () => {
      expect(toNaturalLabel("#bug")).toBe("bug")
      expect(toNaturalLabel("#feature")).toBe("feature")
    })

    it("extracts last segment after slash for namespaced labels", () => {
      expect(toNaturalLabel("org.nostr.git.status/open")).toBe("open")
      expect(toNaturalLabel("org.nostr.git.type/bug")).toBe("bug")
      expect(toNaturalLabel("ns/sub/label")).toBe("label")
    })

    it("returns trimmed label when no namespace", () => {
      expect(toNaturalLabel("simple")).toBe("simple")
      expect(toNaturalLabel("  trimmed  ")).toBe("trimmed")
    })
  })

  describe("normalizeEffectiveLabels", () => {
    it("returns empty flat and byNamespace for null/undefined", () => {
      const result = normalizeEffectiveLabels(null)
      expect(result.flat).toEqual(new Set())
      expect(result.byNamespace).toEqual({})
    })

    it("converts flat array to Set", () => {
      const result = normalizeEffectiveLabels({flat: ["a", "b", "c"]})
      expect(result.flat).toEqual(new Set(["a", "b", "c"]))
    })

    it("converts flat Set to Set", () => {
      const result = normalizeEffectiveLabels({flat: new Set(["x", "y"])})
      expect(result.flat).toEqual(new Set(["x", "y"]))
    })

    it("converts byNamespace object values to Sets", () => {
      const result = normalizeEffectiveLabels({
        byNamespace: {
          "org.nostr.git.status": ["open", "closed"],
          "org.nostr.git.type": ["bug"],
        },
      })
      expect(result.byNamespace["org.nostr.git.status"]).toEqual(new Set(["open", "closed"]))
      expect(result.byNamespace["org.nostr.git.type"]).toEqual(new Set(["bug"]))
    })

    it("filters out non-string values", () => {
      const result = normalizeEffectiveLabels({
        flat: ["a", 1, null, "b"] as any,
        byNamespace: {ns: ["x", undefined, "y"] as any},
      })
      expect(result.flat).toEqual(new Set(["a", "b"]))
      expect(result.byNamespace.ns).toEqual(new Set(["x", "y"]))
    })

    it("converts flat single string to Set", () => {
      const result = normalizeEffectiveLabels({flat: "single"})
      expect(result.flat).toEqual(new Set(["single"]))
    })

    it("treats empty string as falsy and returns empty Set", () => {
      const result = normalizeEffectiveLabels({flat: ""})
      expect(result.flat).toEqual(new Set())
    })
  })

  describe("buildRoleLabelEvent", () => {
    it("returns event with expected shape", () => {
      const event = buildRoleLabelEvent({
        rootId: "root123",
        role: "assignee",
        pubkeys: ["pk1", "pk2"],
        repoAddr: "30617:alice:repo",
        created_at: 1700000000,
      })
      expect(event.kind).toBe(1985)
      expect(event.content).toBe("")
      expect(event.created_at).toBe(1700000000)
      expect(Array.isArray(event.tags)).toBe(true)
      expect(event.tags.some(t => t[0] === "e" && t[1] === "root123")).toBe(true)
      expect(event.tags.some(t => t[0] === "L" && t[1] === ROLE_NS)).toBe(true)
      expect(event.tags.filter(t => t[0] === "p").map(t => t[1])).toEqual(["pk1", "pk2"])
    })

    it("works without optional params", () => {
      const event = buildRoleLabelEvent({
        rootId: "root1",
        role: "reviewer",
        pubkeys: ["pk1"],
      })
      expect(event.kind).toBe(1985)
      expect(event.tags.some(t => t[1] === "reviewer")).toBe(true)
    })
  })

  describe("toNaturalArray", () => {
    it("returns empty array for null/undefined", () => {
      expect(toNaturalArray(null)).toEqual([])
      expect(toNaturalArray(undefined)).toEqual([])
    })

    it("converts iterable to natural labels array", () => {
      expect(toNaturalArray(["org.nostr.git.status/open", "#bug"])).toEqual(["open", "bug"])
    })

    it("deduplicates via Set", () => {
      expect(toNaturalArray(["a", "a", "b"])).toEqual(["a", "b"])
    })

    it("skips non-string values", () => {
      expect(toNaturalArray(["a", 1, "b"] as any)).toEqual(["a", "b"])
    })
  })

  describe("extractRoleAssignments", () => {
    it("returns empty assignees/reviewers for non-array input", () => {
      const result = extractRoleAssignments(null as any)
      expect(result.assignees).toEqual(new Set())
      expect(result.reviewers).toEqual(new Set())
    })

    it("ignores events that are not kind 1985", () => {
      const events = [
        {kind: 1111, tags: []},
        {
          kind: 1985,
          tags: [
            ["L", ROLE_NS],
            ["l", "assignee", ROLE_NS],
            ["e", "root1"],
            ["p", "pk1"],
          ],
        },
      ]
      const result = extractRoleAssignments(events as any)
      expect(result.assignees).toEqual(new Set(["pk1"]))
    })

    it("extracts assignees from role label events", () => {
      const events = [
        {
          kind: 1985,
          tags: [
            ["L", ROLE_NS],
            ["l", "assignee", ROLE_NS],
            ["e", "root1"],
            ["p", "alice"],
            ["p", "bob"],
          ],
        },
      ]
      const result = extractRoleAssignments(events as any)
      expect(result.assignees).toEqual(new Set(["alice", "bob"]))
      expect(result.reviewers).toEqual(new Set())
    })

    it("extracts reviewers from role label events", () => {
      const events = [
        {
          kind: 1985,
          tags: [
            ["L", ROLE_NS],
            ["l", "reviewer", ROLE_NS],
            ["e", "root1"],
            ["p", "charlie"],
          ],
        },
      ]
      const result = extractRoleAssignments(events as any)
      expect(result.assignees).toEqual(new Set())
      expect(result.reviewers).toEqual(new Set(["charlie"]))
    })

    it("filters by rootId when provided", () => {
      const events = [
        {
          kind: 1985,
          tags: [
            ["L", ROLE_NS],
            ["l", "assignee", ROLE_NS],
            ["e", "root1"],
            ["p", "alice"],
          ],
        },
        {
          kind: 1985,
          tags: [
            ["L", ROLE_NS],
            ["l", "assignee", ROLE_NS],
            ["e", "root2"],
            ["p", "bob"],
          ],
        },
      ]
      const result = extractRoleAssignments(events as any, "root1")
      expect(result.assignees).toEqual(new Set(["alice"]))
    })

    it("ignores events without role namespace", () => {
      const events = [
        {
          kind: 1985,
          tags: [
            ["L", "other.ns"],
            ["l", "assignee", "", "other.ns"],
            ["e", "root1"],
            ["p", "alice"],
          ],
        },
      ]
      const result = extractRoleAssignments(events as any)
      expect(result.assignees).toEqual(new Set())
    })
  })

  describe("groupLabels", () => {
    it("groups labels by known namespaces", () => {
      const view = normalizeEffectiveLabels({
        byNamespace: {
          "org.nostr.git.status": ["open", "closed"],
          "org.nostr.git.type": ["bug", "feature"],
          "org.nostr.git.area": ["ui"],
          "#t": ["urgent"],
          [ROLE_NS]: ["assignee"],
          "unknown.ns": ["custom"],
        },
      })
      const result = groupLabels(view)
      expect(result.Status).toEqual(["open", "closed"])
      expect(result.Type).toEqual(["bug", "feature"])
      expect(result.Area).toEqual(["ui"])
      expect(result.Tags).toEqual(["urgent"])
      expect(result.Role).toEqual(["assignee"])
      expect(result.Other).toEqual(["custom"])
    })

    it("returns empty arrays for empty view", () => {
      const view = normalizeEffectiveLabels({})
      const result = groupLabels(view)
      expect(result.Status).toEqual([])
      expect(result.Type).toEqual([])
      expect(result.Area).toEqual([])
      expect(result.Tags).toEqual([])
      expect(result.Role).toEqual([])
      expect(result.Other).toEqual([])
    })
  })
})
