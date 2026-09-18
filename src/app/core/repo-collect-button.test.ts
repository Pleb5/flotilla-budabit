import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const source = readFileSync(
  new URL("../components/RepoCollectButton.svelte", import.meta.url),
  "utf8",
)
const modalSource = readFileSync(
  new URL("../components/RepoCollectModal.svelte", import.meta.url),
  "utf8",
)

describe("repository collection button reads", () => {
  it("uses split targeted-original filters and external relay hints", () => {
    expect(source).toContain("makeTargetedPublicationOriginalFilterPlan(")
    expect(source).not.toContain("makeTargetedPublicationOriginalFilters")
    expect(source).toContain("makeCommunityContentFilterPlan(")
    expect(source).toContain("userCommunityStarTargetFilterPlan.relayFilters")
    expect(source).toContain("userCommunityStarTargetFilterPlan.localFilters")
    expect(source).toContain("userCommunityStarReactionFilterPlan.relayFilters")
    expect(source).toContain("userCommunityStarReactionFilterPlan.localFilters")
    expect(source).toContain("parseTargetedPublication(event)?.source?.relay")
    expect(source).toContain("makeTargetedPublicationForCommunity({")
    expect(source).toContain("originalRef: starThunk?.event?.id")
    expect(source).not.toContain('"#p": communityIds')
    expect(source).toContain("loadBoundedCommunityHistory({")
    expect(source).toContain("localFilters,")
  })

  it("shares bounded requests while retaining their completion result", () => {
    expect(source).toContain("const loadedFilterRequests = new Map<string, Promise<boolean>>()")
    expect(source).toContain(".then(result => result.complete)")
    expect(source).toContain("localTargetHistoryComplete = complete")
    expect(source).toContain("localDeleteHistoryComplete = complete")
    expect(source).toContain("localOriginalHistoryComplete = complete")
    expect(source).toContain("loadedFilterRequests.delete(key)")
  })

  it("represents incomplete empty reads as indeterminate and preserves known collections", () => {
    expect(source).toContain("communityHistoryComplete && personalHistoryComplete")
    expect(source).toContain("data-collection-status={collectionStatus}")
    expect(source).toContain("Manage repository collections")
    expect(source).not.toContain("history is incomplete")
    expect(source).toContain("lockedCommunityAddresses: communityHistoryCompleteAtOpen")
    expect(modalSource).toContain("lockedCommunities.has(option.address)")
  })
})
