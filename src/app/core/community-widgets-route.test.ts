import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const source = readFileSync(
  new URL("../../routes/c/[community]/widgets/+page.svelte", import.meta.url),
  "utf8",
)

describe("community widgets route history", () => {
  it("admits granted wrappers and same-author deletes locally", () => {
    expect(source).toContain("makeCommunityContentFilterPlan(")
    expect(source).toContain("targetingFilterPlan.localFilters")
    expect(source).toContain("filterAuthorizedCommunityTargetingEvents({")
    expect(source).toContain("makeSameAuthorDeleteFilters(authorizedTargetingEvents)")
    expect(source).toContain("return {relayFilters: filters, localFilters: filters}")
    expect(source).toContain("filters: targetDeleteFilterPlan.localFilters")
    expect(source).toContain('import {getDeletedTargetEventIds} from "@app/core/deletion-rules"')
    expect(source).not.toContain("LegacyCommunityTargeting")
    expect(source).not.toContain("LegacyTargetedPublication")
  })

  it("tracks bounded wrapper, delete, and explicit-hint original reads", () => {
    expect(source.match(/loadBoundedCommunityHistory\(\{/g)).toHaveLength(3)
    expect(source).not.toContain('import {request} from "@welshman/net"')
    expect(source).not.toContain("request({")
    expect(source).not.toContain(".catch(() => undefined)")
    expect(source).toContain("relayFilters: targetingFilterPlan.relayFilters")
    expect(source).toContain("localFilters: targetingFilterPlan.localFilters")
    expect(source).toContain("const relayFilters = targetDeleteFilterPlan.relayFilters")
    expect(source).toContain("const localFilters = targetDeleteFilterPlan.localFilters")
    expect(source).toContain("makeTargetedPublicationOriginalRelayHintPlans(")
    expect(source).toMatch(
      /plans\.map\(plan =>[\s\S]*loadBoundedCommunityHistory\(\{[\s\S]*\.\.\.plan/,
    )

    for (const stage of ["target", "targetDelete", "originalWidget"]) {
      expect(source).toContain(`let ${stage}RequestSettled = $state(false)`)
    }
    // Reconciliation/retry now belongs to the foreground coordinator; initial
    // content readiness remains independent of complete deletion history.
    expect(source).toContain("<DeletionHydration")
    expect(source).toContain("sourcePlans={widgetRelayHintPlans}")
  })

  it("keeps partial-history diagnostics out of the widget UI", () => {
    expect(source).not.toContain("widgetHistoryIncomplete")
    expect(source).not.toContain("retryWidgetHistory")
    expect(source).not.toContain("Targeted widget history is incomplete")
    expect(source).not.toContain("partial history loaded")
    expect(source).toContain("No targeted widgets found.")
  })
})
