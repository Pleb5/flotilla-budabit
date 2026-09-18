import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("community room and thread route transport", () => {
  it("keeps home and menu room selection local while home requests structural filters", () => {
    const home = readProjectFile("../../routes/c/[community]/+page.svelte")
    const menu = readProjectFile("../components/CommunityMenu.svelte")

    expect(home).toContain("makeCommunityContentFilterPlan")
    expect(home).toContain("const roomFilters = $derived(roomFilterPlan.localFilters)")
    expect(home).toContain("loadBoundedCommunityHistory({")
    expect(home).toContain("relayFilters,")
    expect(home).toContain("localFilters: filters")
    expect(home).toContain("roomRootsComplete = result.complete")
    expect(home).not.toContain("rooms.length > 0 && roomRootsIncomplete")
    expect(home).not.toContain("Room history is incomplete; some rooms may be missing.")
    expect(home).not.toContain("retryRoomHistory")
    expect(menu).toContain("const roomFilters = $derived(roomFilterPlan.localFilters)")
  })

  it("uses broad thread feeds and hydration with author-qualified projections", () => {
    const list = readProjectFile("../../routes/c/[community]/threads/+page.svelte")
    const detail = readProjectFile("../../routes/c/[community]/threads/[thread]/+page.svelte")

    expect(list).toContain("relayFilters: feedRelayFilters")
    expect(list).toContain('feedLoadStatus = complete ? "complete" : "incomplete"')
    expect(list).toContain("threadAuthorPubkeys.includes(event.pubkey)")
    expect(list).toContain("replyAuthorPubkeys.includes(event.pubkey)")
    expect(detail).toContain("const threadFilters = $derived(threadFilterPlan.localFilters)")
    expect(detail).toContain("const replyFilters = $derived(replyFilterPlan.localFilters)")
    expect(detail).toContain("loadBoundedCommunityHistory({")
    expect(detail).toContain("relayFilters,")
    expect(detail).toContain("localFilters,")
    expect(detail).toContain('threadLoadStatus = result.complete ? "complete" : "incomplete"')
    expect(detail).toContain("threadAuthorPubkeys.includes(event.pubkey)")
    expect(detail).toContain("replyAuthorPubkeys.includes(event.pubkey)")
    expect(detail).not.toContain("Reply history is incomplete")
    expect(detail).not.toContain(
      'replies.length === 0 && (threadLoadStatus === "incomplete" || threadLoadStatus === "failed")',
    )
  })

  it("uses broad room lookup, message feed, and hash recovery with local admission", () => {
    const room = readProjectFile("../../routes/c/[community]/rooms/[room]/+page.svelte")

    expect(room).toContain("const roomFilters = $derived(roomFilterPlan.localFilters)")
    expect(room).toContain("const messageFilters = $derived(messageFilterPlan.localFilters)")
    expect(room).toContain("filters: roomRelayFilters")
    expect(room).toContain("relayFilters: messageRelayFilters")
    expect(room).toContain("filters: relayFilters")
    expect(room).toContain("matchFilters(localFilters, cachedTarget)")
    expect(room).toContain("matchFilters(localFilters, event)")
    expect(room).toContain('feedLoadStatus = complete ? "complete" : "incomplete"')
  })

  it("uses direct-only bounded repository history", () => {
    const communityGit = readProjectFile("../../routes/c/[community]/git/+page.svelte")
    const globalGit = readProjectFile("../../routes/git/+page.svelte")

    expect(communityGit).toContain("loadBoundedCommunityHistory({")
    expect(communityGit).toContain("relayFilters,")
    expect(communityGit).toContain("localFilters,")
    expect(communityGit).toContain("makeCommunityRepositoryFilter(communityId)")
    expect(communityGit).toContain("isAuthorizedDirectCommunityRepo({")
    expect(communityGit).not.toContain("communityRepoAssociationFilterPlan")
    expect(communityGit).not.toContain("TARGETED_PUBLICATION_KIND")
    expect(communityGit).not.toContain("Repository history is incomplete")
    expect(globalGit).toContain("loadBoundedCommunityHistory({")
    expect(globalGit).toContain("relayFilters,")
    expect(globalGit).toContain("localFilters,")
    expect(globalGit).toContain("directCommunityRepoHistoryIncomplete = !result.complete")
    expect(globalGit).toContain(
      "makeCommunityRepositoryFilter(selectedCommunityDefinition.communityId",
    )
    expect(globalGit).toContain("communityStarTargetFilterPlan.localFilters")
    expect(globalGit).toContain("communitySnippetTargetFilterPlan.localFilters")
    expect(globalGit).toContain("isAuthorizedDirectCommunityRepo({")
    expect(globalGit).not.toContain("authorizedCommunityRepoTargetEvents")
    expect(globalGit).toContain("authorizedCommunityStarTargetEvents")
    expect(globalGit).toContain("authorizedCommunitySnippetTargetEvents")
    expect(globalGit).toContain("makeTargetedPublicationOriginalFilterPlan(")
    expect(globalGit).toContain("makeTargetedPublicationOriginalRelayHintPlans(")
    expect(globalGit).not.toContain("makeTargetedPublicationOriginalFilters")
    expect(globalGit).not.toContain("Community repository history is incomplete")
    expect(globalGit).not.toContain("retryCommunityRepoHistory")
    expect(globalGit).not.toContain("option.about ?")
  })

  it("uses authorized wrappers and split original plans for community widgets", () => {
    const widgets = readProjectFile("../../routes/c/[community]/widgets/+page.svelte")

    expect(widgets).toContain("filterAuthorizedCommunityTargetingEvents({")
    expect(widgets).toContain("makeTargetedPublicationOriginalFilterPlan(")
    expect(widgets).toContain("widgetFilterPlan.localFilters")
    expect(widgets).toContain("const relayFilters = widgetFilterPlan.relayFilters")
    expect(widgets).toContain("targetHistoryIncomplete = !result.complete")
    expect(widgets).not.toContain("Targeted widget history is incomplete")
    expect(widgets).not.toContain("makeTargetedPublicationOriginalFilters")
  })
})
