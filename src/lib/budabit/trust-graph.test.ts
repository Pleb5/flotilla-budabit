import {describe, expect, it} from "vitest"
import {applyTrustGraphRules, doesTrustGraphRuleMatch} from "./trust-graph"
import {normalizeTrustGraphConfig, normalizeTrustGraphRule} from "./trust-graph-config"

describe("trust graph rules", () => {
  it("matches numeric thresholds correctly", () => {
    expect(
      doesTrustGraphRuleMatch(normalizeTrustGraphRule({operator: "gte", threshold: 10}), 12),
    ).toBe(true)
    expect(
      doesTrustGraphRuleMatch(normalizeTrustGraphRule({operator: "lte", threshold: 10}), 12),
    ).toBe(false)
  })

  it("adds people outside the base graph when an include rule matches", () => {
    const candidatePubkeys = ["a".repeat(64), "b".repeat(64)]
    const scores = applyTrustGraphRules({
      candidatePubkeys,
      basicScores: new Map([["a".repeat(64), 3]]),
      config: normalizeTrustGraphConfig({
        rules: [
          normalizeTrustGraphRule({
            action: "include",
            operator: "gte",
            threshold: 100,
            source: {
              type: "nip85",
              serviceKey: "f".repeat(64),
              kindTag: "30382:followers",
            },
          }),
        ],
      }),
      assertionsByServiceKey: new Map([
        ["f".repeat(64), new Map([["b".repeat(64), {pubkey: "b".repeat(64), followers: 250}]])],
      ]),
    })

    expect(scores.get("a".repeat(64))).toBe(3)
    expect(scores.get("b".repeat(64))).toBe(1)
  })

  it("removes base graph members when an exclude rule matches", () => {
    const targetPubkey = "a".repeat(64)
    const scores = applyTrustGraphRules({
      candidatePubkeys: [targetPubkey],
      basicScores: new Map([[targetPubkey, 4]]),
      config: normalizeTrustGraphConfig({
        rules: [
          normalizeTrustGraphRule({
            action: "exclude",
            operator: "gte",
            threshold: 5,
            source: {
              type: "nip85",
              serviceKey: "f".repeat(64),
              kindTag: "30382:reports_cnt_recd",
            },
          }),
        ],
      }),
      assertionsByServiceKey: new Map([
        ["f".repeat(64), new Map([[targetPubkey, {pubkey: targetPubkey, reportsCntRecd: 7}]])],
      ]),
    })

    expect(scores.has(targetPubkey)).toBe(false)
  })
})
