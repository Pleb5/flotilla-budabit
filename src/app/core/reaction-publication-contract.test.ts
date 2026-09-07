import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("reaction publication source contracts", () => {
  it("routes ordinary reaction creation through publication operations", () => {
    const publishers = [
      "../components/ThreadActions.svelte",
      "../components/RoomItem.svelte",
      "../components/RepoFeedGitItem.svelte",
      "../components/PRView.svelte",
      "../components/NoteItem.svelte",
      "../components/GoalActions.svelte",
      "../components/EventActions.svelte",
      "../components/CommentActions.svelte",
      "../components/ChannelMessage.svelte",
      "../components/CalendarEventActions.svelte",
      "../components/ChannelMessageMenuMobile.svelte",
      "../components/ChannelMessageEmojiButton.svelte",
      "../components/RoomItemMenuMobile.svelte",
      "../components/RoomItemMenu.svelte",
      "../components/RoomItemEmojiButton.svelte",
      "../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte",
      "../../routes/git/[id=naddr]/commits/[commitid]/+page.svelte",
    ]

    for (const publisher of publishers) {
      const source = readProjectFile(publisher)
      expect(source, publisher).toContain("publishReactionOperation(")
      expect(source, publisher).not.toMatch(/\bpublishReaction\(/)
    }
  })

  it("routes exact reaction deletes through rollback operations", () => {
    const publishers = [
      "../components/ThreadActions.svelte",
      "../components/RoomItem.svelte",
      "../components/RepoFeedGitItem.svelte",
      "../components/PRView.svelte",
      "../components/NoteItem.svelte",
      "../components/GoalActions.svelte",
      "../components/CommentActions.svelte",
      "../components/ChannelMessage.svelte",
      "../components/CalendarEventActions.svelte",
      "../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte",
      "../../routes/git/[id=naddr]/commits/[commitid]/+page.svelte",
    ]

    for (const publisher of publishers) {
      expect(readProjectFile(publisher), publisher).toContain("publishReactionDeleteOperation(")
    }
  })

  it("centralizes rollback projection without classifying repository collection stars", () => {
    const summary = readProjectFile("../components/ReactionSummary.svelte")
    const commands = readProjectFile("./commands.ts")
    const repoCollection = readProjectFile("../components/RepoCollectButton.svelte")

    expect(summary).toContain("projectReactionOperations({")
    expect(summary).toContain("pendingSemanticKeys.has(semanticKey)")
    expect(summary).toContain("getReplyFilters([event]")
    expect(summary).toContain("const filterPlan = reactionLoadFilterPlan")
    expect(summary).toContain("filters: filterPlan.relayFilters")
    expect(summary).toContain("matchFilters(filterPlan.localFilters, event)")
    expect(summary).toContain("makeSameAuthorDeleteFilters(admittedEvents)")
    expect(commands).toContain('preview: "rollback-on-failure"')
    expect(repoCollection).not.toContain("publishReactionOperation")
    expect(repoCollection).not.toContain("publishReactionDeleteOperation")
  })

  it("separates reaction and report admission while retaining the generic fallback", () => {
    const summary = readProjectFile("../components/ReactionSummary.svelte")
    const reportDetails = readProjectFile("../components/ReportDetails.svelte")

    expect(summary).toContain("reactionAllowedAuthors?: string[]")
    expect(summary).toContain("reportAllowedAuthors?: string[]")
    expect(summary).toContain("reactionAllowedAuthors ?? allowedAuthors")
    expect(summary).toContain("reportAllowedAuthors ?? allowedAuthors")
    expect(summary).toContain("allowedAuthors: effectiveReactionAllowedAuthors")
    expect(summary).toContain("effectiveReportAllowedAuthors")
    expect(summary).toContain("matchFilters(reactionAdmissionFilterPlan.localFilters, event)")
    expect(summary).toContain("matchFilters(reportAdmissionFilterPlan.localFilters, event)")
    expect(summary).toContain("allowedAuthors: effectiveReportAllowedAuthors")
    expect(reportDetails).toContain("activeCommunityReportAuthors = $derived.by")
    expect(reportDetails).toContain("$activeCommunityProfileListEvents")
    expect(reportDetails).toContain("target: COMMUNITY_WRITE_TARGETS.report")
    expect(reportDetails).toContain("reportState: $activeCommunityReportState")
    expect(reportDetails).toContain("activeCommunityReportAuthors ?? allowedAuthors")
    expect(reportDetails).toContain("const reportFilters = $derived.by")
    expect(reportDetails).toContain(
      "...(effectiveAllowedAuthors ? {authors: effectiveAllowedAuthors} : {})",
    )
    expect(reportDetails).toContain("const reports = $derived(deriveEventsById")
    expect(summary).toContain("relays: loadRelays")
    expect(summary).toContain("relays.length > 0 ? relays : !scopeH && url ? [url] : []")
    expect(summary).not.toContain('url: url || loadRelays[0] || ""')
    expect(reportDetails).toContain("<ReportItem {relays}")

    const reportItem = readProjectFile("../components/ReportItem.svelte")
    expect(reportItem).toContain("publishDelete({event, relays, optimistic: false})")
    expect(reportItem).not.toContain("relays: [url]")
  })

  it("awaits same-author delete history for admitted and cached reactions and reports", () => {
    const summary = readProjectFile("../components/ReactionSummary.svelte")

    expect(summary).not.toContain("onMount")
    expect(summary.match(/\$effect\(\(\) => \{/g)).toHaveLength(5)
    expect(summary).toContain("const deleteResult = await loadBoundedCommunityHistory({")
    expect(summary).toContain("complete: result.complete && deleteResult.complete")
    expect(summary).toContain("const cachedReactions = canonicalReactions")
    expect(summary).toContain("makeSameAuthorDeleteFilters(cachedReactions)")
    expect(summary).toContain("const cachedReports = scopedReports")
    expect(summary).toContain("makeSameAuthorDeleteFilters(cachedReports)")
    expect(summary).toContain("owner: `reaction-summary:${event.id}:cached-deletes`")
    expect(summary).toContain("owner: `report-summary:${event.id}:cached-deletes`")
    expect(summary).not.toContain("Engagement incomplete")
    expect(summary).toContain("effectiveReactionAllowedAuthors")
    expect(summary).toContain("const filterPlan = reportLoadFilterPlan")
  })

  it("propagates comment, reaction, and report writers through community social surfaces", () => {
    const routes = [
      "../../routes/c/[community]/threads/+page.svelte",
      "../../routes/c/[community]/threads/[thread]/+page.svelte",
      "../../routes/c/[community]/rooms/[room]/+page.svelte",
      "../../routes/c/[community]/goals/+page.svelte",
      "../../routes/c/[community]/goals/[goal]/+page.svelte",
      "../../routes/c/[community]/calendar/+page.svelte",
      "../../routes/c/[community]/calendar/[event]/+page.svelte",
    ]
    const components = [
      "../components/ThreadItem.svelte",
      "../components/ThreadActions.svelte",
      "../components/RoomItem.svelte",
      "../components/ChannelMessage.svelte",
      "../components/GoalItem.svelte",
      "../components/GoalActions.svelte",
      "../components/CalendarEventItem.svelte",
      "../components/CalendarEventActions.svelte",
    ]

    for (const route of routes) {
      const source = readProjectFile(route)
      expect(source, route).toContain("target: COMMUNITY_WRITE_TARGETS.reaction")
      expect(source, route).toContain("target: COMMUNITY_WRITE_TARGETS.report")
      expect(source, route).toContain("reactionAllowedAuthors={reactionAuthorPubkeys}")
      expect(source, route).toContain("reportAllowedAuthors={reportAuthorPubkeys}")
    }
    for (const component of components) {
      const source = readProjectFile(component)
      expect(source, component).toContain("reactionAllowedAuthors?: string[]")
      expect(source, component).toContain("reportAllowedAuthors?: string[]")
      expect(source, component).toContain("{reactionAllowedAuthors}")
      expect(source, component).toContain("{reportAllowedAuthors}")
    }

    for (const component of [
      "../components/ThreadActions.svelte",
      "../components/GoalActions.svelte",
      "../components/CalendarEventActions.svelte",
    ]) {
      const activity = readProjectFile(component).match(/<EventActivity[\s\S]*?\/>/)?.[0] || ""
      expect(activity, component).toContain("{allowedAuthors}")
      expect(activity, component).not.toContain("reactionAllowedAuthors")
      expect(activity, component).not.toContain("reportAllowedAuthors")
    }
  })

  it("keeps calendar reaction transport on community-definition relays", () => {
    const listRoute = readProjectFile("../../routes/c/[community]/calendar/+page.svelte")
    const detailRoute = readProjectFile("../../routes/c/[community]/calendar/[event]/+page.svelte")
    const item = readProjectFile("../components/CalendarEventItem.svelte")
    const actions = readProjectFile("../components/CalendarEventActions.svelte")
    const eventActions = readProjectFile("../components/EventActions.svelte")

    for (const route of [listRoute, detailRoute]) {
      expect(route).toContain("reactionRelays={$activeExactCommunityRelays}")
      expect(route).toContain("$activeExactCommunityRelays.length > 0")
      expect(route).toContain("reactionAllowedAuthors={reactionAuthorPubkeys}")
    }
    expect(item).toContain("{reactionRelays}")
    expect(actions).toContain("relays: reactionRelayTargets")
    expect(actions).toContain("operationRelays={reactionRelayTargets}")
    expect(actions).toContain("reactionRelays={reactionRelayTargets}")
    expect(eventActions).toContain("reactionRelays ?? relays")
    expect(actions).not.toContain(
      "publishReactionDeleteOperation({reaction, relays: actionRelays})",
    )
  })
})
