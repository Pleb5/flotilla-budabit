import {afterEach, describe, expect, it, vi} from "vitest"
import {repository} from "@welshman/app"
import {
  applyTrustGraphRules,
  buildBasicTrustGraph,
  doesTrustGraphRuleMatch,
  getBasicTrustGraphScore,
  getDeclaredRepoMaintainerPubkeys,
} from "./trust-graph"
import {normalizeTrustGraphConfig, normalizeTrustGraphRule} from "./trust-graph-config"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("trust graph rules", () => {
  it("adds declared repo maintainers to the base graph", () => {
    const viewerPubkey = "1".repeat(64)
    const maintainerPubkey = "2".repeat(64)
    const scores = buildBasicTrustGraph(viewerPubkey, [], new Map(), [maintainerPubkey])

    expect(scores.get(maintainerPubkey)).toBe(3)
  })

  it("keeps higher social scores for declared repo maintainers", () => {
    const viewerPubkey = "1".repeat(64)
    const maintainerPubkey = "2".repeat(64)
    const scores = buildBasicTrustGraph(viewerPubkey, [], new Map([[maintainerPubkey, 7]]), [
      maintainerPubkey,
    ])

    expect(scores.get(maintainerPubkey)).toBe(7)
    expect(
      getBasicTrustGraphScore(
        viewerPubkey,
        maintainerPubkey,
        [],
        new Map([[maintainerPubkey, 7]]),
        [maintainerPubkey],
      ),
    ).toBe(7)
  })

  it("reads declared repo maintainers from current-user repo announcements", () => {
    const viewerPubkey = "1".repeat(64)
    const maintainerPubkey = "2".repeat(64)
    vi.spyOn(repository, "query").mockReturnValue([
      {
        id: "a".repeat(64),
        kind: 30617,
        pubkey: viewerPubkey,
        created_at: 1,
        tags: [
          ["d", "demo"],
          ["maintainers", maintainerPubkey],
        ],
        content: "",
        sig: "",
      } as any,
    ])

    expect(getDeclaredRepoMaintainerPubkeys(viewerPubkey)).toEqual([maintainerPubkey])
  })

  it("ignores deleted repo announcements when reading declared maintainers", () => {
    const viewerPubkey = "1".repeat(64)
    const maintainerPubkey = "2".repeat(64)
    vi.spyOn(repository, "query").mockReturnValue([
      {
        id: "a".repeat(64),
        kind: 30617,
        pubkey: viewerPubkey,
        created_at: 1,
        tags: [["d", "demo"], ["maintainers", maintainerPubkey], ["deleted"]],
        content: "",
        sig: "",
      } as any,
    ])

    expect(getDeclaredRepoMaintainerPubkeys(viewerPubkey)).toEqual([])
  })

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

  it("can remove declared repo maintainers with an exclude rule", () => {
    const viewerPubkey = "1".repeat(64)
    const maintainerPubkey = "2".repeat(64)
    const basicScores = buildBasicTrustGraph(viewerPubkey, [], new Map(), [maintainerPubkey])
    const scores = applyTrustGraphRules({
      candidatePubkeys: [maintainerPubkey],
      basicScores,
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
        [
          "f".repeat(64),
          new Map([[maintainerPubkey, {pubkey: maintainerPubkey, reportsCntRecd: 7}]]),
        ],
      ]),
    })

    expect(scores.has(maintainerPubkey)).toBe(false)
  })
})
