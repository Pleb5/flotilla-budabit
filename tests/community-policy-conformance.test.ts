import {describe, expect, it} from "vitest"
import {checkPolicyVectors} from "../scripts/check-community-policy-vectors.mjs"

const commit = "a".repeat(40)
const fixture = () => ({
  format: 1,
  budabitCommit: commit,
  generatedAt: "2026-09-13T00:00:00Z",
  branches: ["branch"],
  scenarios: [{cases: [{expect: "accept"}]}],
  definitions: [{valid: true}],
})

describe("policy-vector drift gate", () => {
  it("ignores timestamp and provenance-only changes, and object key order", () => {
    expect(
      checkPolicyVectors(
        fixture(),
        {...fixture(), generatedAt: "2026-09-12T00:00:00Z", budabitCommit: "b".repeat(40)},
        commit,
      ),
    ).toMatch(/^[0-9a-f]{64}$/)
  })
  it("fails when an admission result or protocol result changes", () => {
    for (const patch of [
      {scenarios: [{cases: [{expect: "reject"}]}]},
      {definitions: [{valid: false}]},
    ]) {
      expect(() => checkPolicyVectors({...fixture(), ...patch}, fixture(), commit)).toThrow("stale")
    }
  })
  it("validates fresh provenance independently", () => {
    expect(() => checkPolicyVectors(fixture(), fixture(), "b".repeat(40))).toThrow("not exported")
    expect(() =>
      checkPolicyVectors({...fixture(), budabitCommit: "unknown"}, fixture(), commit),
    ).toThrow("provenance")
  })
  it("does not omit new payload fields or reorder semantic arrays", () => {
    expect(() => checkPolicyVectors({...fixture(), newRule: true}, fixture(), commit)).toThrow(
      "stale",
    )
    expect(() =>
      checkPolicyVectors(
        {...fixture(), branches: ["b", "a"]},
        {...fixture(), branches: ["a", "b"]},
        commit,
      ),
    ).toThrow("stale")
  })
})
