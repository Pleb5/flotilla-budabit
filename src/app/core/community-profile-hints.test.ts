import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("community profile relay hints", () => {
  it("uses the Budabit profile resolver with community relays in community cards", () => {
    const preview = readProjectFile("../components/community/CommunityPreviewCard.svelte")
    const selector = readProjectFile("../components/community/CommunitySelectorCard.svelte")
    const link = readProjectFile("../components/community/CommunityLinkCard.svelte")

    for (const source of [preview, selector, link]) {
      expect(source).toContain("@app/core/profile-resolver")
      expect(source).toContain("deriveBudabitProfile")
      expect(source).toContain("deriveBudabitProfileDisplay")
    }

    expect(preview).toContain("communityRelays: profileRelays")
    expect(selector).toContain("communityRelays: profileRelays")
    expect(link).toContain("communityRelays: displayRelays")
  })

  it("passes scoped community profile relays through membership and moderation surfaces", () => {
    const access = readProjectFile("../../routes/c/[community]/access/+page.svelte")
    const admin = readProjectFile("../../routes/c/[community]/admin/+page.svelte")
    const moderation = readProjectFile("../../routes/c/[community]/moderation/+page.svelte")
    const badges = readProjectFile("../../routes/c/[community]/badges/+page.svelte")
    const contentReport = readProjectFile(
      "../components/community/CommunityContentReportCard.svelte",
    )
    const reportCard = readProjectFile("../components/community/ModerationReportCard.svelte")
    const reportList = readProjectFile("../components/community/ModerationReportList.svelte")

    for (const source of [access, admin, moderation, badges]) {
      expect(source).toContain("communityProfileRelays")
      expect(source).toMatch(/relays=\{communityProfileRelays\}/)
    }

    expect(moderation).toContain(
      "<CommunityContentReportCard {group} relays={communityProfileRelays} />",
    )
    expect(admin).toContain("relays={communityProfileRelays}")
    expect(contentReport).toContain("relays?: string[]")
    expect(contentReport).toContain("relays={profileRelays}")
    expect(reportCard).toContain("relays?: string[]")
    expect(reportCard).toContain("relays={profileRelays}")
    expect(reportList).toContain("<ModerationReportCard {report} {showReporter} {relays} />")
  })

  it("keeps chat profile reads on the Budabit resolver with explicit relay hints", () => {
    const roomItem = readProjectFile("../components/RoomItem.svelte")
    const channelMessage = readProjectFile("../components/ChannelMessage.svelte")
    const chatMessage = readProjectFile("../components/ChatMessage.svelte")

    expect(roomItem).toContain("deriveBudabitProfileDisplay")
    expect(roomItem).toContain("relays: profileRelayHints")
    expect(channelMessage).toContain("deriveBudabitProfileDisplay")
    expect(channelMessage).toContain("relays: relayTargets")
    expect(channelMessage).toMatch(
      /pushModal\(ProfileDetail, \{pubkey: event\.pubkey, url, relays: relayTargets\}\)/,
    )
    expect(chatMessage).toContain("deriveBudabitProfileDisplay")
  })

  it("does not use repo route relayUrl as a profile hint in repo views", () => {
    for (const path of [
      "../../routes/git/[id=naddr]/+page.svelte",
      "../../routes/git/[id=naddr]/prs/+page.svelte",
    ]) {
      const source = readProjectFile(path)

      expect(source).toContain("repoCommunityProfileRelays")
      expect(source).not.toMatch(/<(ProfileCircle|ProfileLink|ProfileName)[^>]+url=\{relayUrl\}/s)
      expect(source).not.toMatch(/pushModal\(ProfileDetail,\s*\{[^}]*url:\s*relayUrl/s)
    }
  })
})
