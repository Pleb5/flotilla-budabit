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

  it("parses community home descriptions instead of rendering raw text", () => {
    const home = readProjectFile("../../routes/c/[community]/+page.svelte")

    expect(home).toContain('import Content from "@app/components/Content.svelte"')
    expect(home).toContain("const communityDescriptionEvent = $derived({content: communityDescription, tags: []})")
    expect(home).toContain("<Content event={communityDescriptionEvent} showEntire />")
    expect(home).not.toContain("kind: 1")
    expect(home).not.toMatch(
      /<div class="max-w-3xl text-center md:text-xl">\s*\{communityDescription\}\s*<\/div>/,
    )
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

  it("hydrates community member lists and makes member avatars open profiles", () => {
    const access = readProjectFile("../../routes/c/[community]/access/+page.svelte")
    const admin = readProjectFile("../../routes/c/[community]/admin/+page.svelte")

    for (const source of [access, admin]) {
      expect(source).toContain("hydratePubkeyProfiles")
      expect(source).toContain("ProfileDetail")
      expect(source).toContain("relays: communityProfileRelays")
      expect(source).toContain("relays={communityProfileRelays}")
      expect(source).toContain("preventDefault(() => openProfile")
    }

    expect(access).toContain("openProfile(member.pubkey)")
    expect(admin).toContain("openProfile(person.pubkey)")
  })

  it("keeps repo cards on resolver-backed profile avatars instead of direct cache reads", () => {
    const gitPage = readProjectFile("../../routes/git/+page.svelte")
    const gitItem = readProjectFile("../components/GitItem.svelte")
    const noteCard = readProjectFile("../components/NoteCard.svelte")

    expect(gitPage).toContain(
      "loadBudabitProfile(event.pubkey, {communityRelays: selectedCommunityProfileRelays})",
    )
    expect(gitPage).toContain("const selectedCommunityProfileRelays")
    expect(gitPage).toContain(
      '...(activeMode === "community" ? selectedCommunityProfileRelays : [])',
    )
    expect(gitPage).toContain("profileRelays={cardProfileRelays}")
    expect(gitPage).toContain("openRepoCardProfile(g.owner, cardProfileRelays)")
    expect(gitPage).not.toContain("loadProfile(event.pubkey, [])")
    expect(gitPage).not.toContain("loadProfile(pubkey, [])")
    expect(gitPage).not.toContain('...(activeMode === "community" ? selectedCommunityRelays : [])')
    expect(gitPage).not.toContain("AvatarImage src={prof?.picture}")
    expect(gitPage).not.toContain("{@const prof = $profilesByPubkey.get")
    expect(gitItem).toContain("profileRelays?: string[]")
    expect(gitItem).toContain("relays={profileRelays}")
    expect(gitItem).not.toContain("profilesByPubkey")
    expect(noteCard).toContain("relays?: string[]")
    expect(noteCard).toContain("<Profile pubkey={event.pubkey} {url} {relays} />")
  })

  it("passes repo community profile relays through the repo layout owner profile", () => {
    const layout = readProjectFile("../../routes/git/[id=naddr]/+layout.svelte")
    const overview = readProjectFile("../../routes/git/[id=naddr]/+page.svelte")
    const prs = readProjectFile("../../routes/git/[id=naddr]/prs/+page.svelte")
    const issue = readProjectFile("../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte")

    expect(layout).toContain("const repoCommunityProfileRelays")
    expect(layout).toContain("REPO_PROFILE_RELAYS_KEY")
    expect(layout).toContain(
      "await loadBudabitProfile(pubkey, {communityRelays: repoCommunityProfileRelays})",
    )
    expect(layout).toContain(
      "<ProfileName pubkey={repoPubkey} relays={repoCommunityProfileRelays} />",
    )
    expect(layout).toContain("relays: repoCommunityProfileRelays")
    expect(layout).not.toContain("pushModal(ProfileDetail, {pubkey: repoPubkey})")

    for (const source of [overview, prs, issue]) {
      expect(source).toContain("REPO_PROFILE_RELAYS_KEY")
      expect(source).toContain("repoProfileRelays?.()")
    }
  })

  it("passes repo community profile relays through issue list cards", () => {
    const issueList = readProjectFile("../../routes/git/[id=naddr]/issues/+page.svelte")
    const issueCard = readProjectFile(
      "../../../packages/nostr-git-ui/src/lib/components/git/IssueCard.svelte",
    )
    const nostrAvatar = readProjectFile(
      "../../../packages/nostr-git-ui/src/lib/components/git/NostrAvatar.svelte",
    )

    expect(issueList).toContain("REPO_PROFILE_RELAYS_KEY")
    expect(issueList).toContain("profileRelays={repoCommunityProfileRelays}")
    expect(issueCard).toContain("profileRelays?: string[]")
    expect(issueCard).toContain("<ProfileLink pubkey={event.pubkey} relays={profileRelays} />")
    expect(issueCard).toContain("relays={profileRelays}")
    expect(nostrAvatar).toContain("relays?: string[]")
    expect(nostrAvatar).toContain("relays={relays}")
  })

  it("keeps Svelte profile preloads on the Budabit resolver", () => {
    for (const path of [
      "../../routes/people/[profile]/+page.svelte",
      "../components/ProfileCodeTrustAnalysis.svelte",
      "../../routes/settings/trust/+page.svelte",
      "../../routes/settings/trust/ProviderRecommendationRow.svelte",
      "../../routes/settings/trust/MetricSourcePicker.svelte",
    ]) {
      const source = readProjectFile(path)

      expect(source).toContain("loadBudabitProfile")
      expect(source).not.toContain("loadProfile(")
    }
  })

  it("hydrates PR diff comment author profiles with profile relays", () => {
    const prView = readProjectFile("../components/PRView.svelte")

    expect(prView).toContain("prCommentProfileLoadKey")
    expect(prView).toContain("loadBudabitProfile(commentPubkey, {communityRelays: profileRelays})")
  })

  it("preserves nprofile relay hints through markdown profile mounts", () => {
    const renderers = readProjectFile("../../lib/components/markdown/markdownRenderers.ts")
    const mounter = readProjectFile("../../lib/components/markdown/markdownComponentMounter.ts")

    expect(renderers).toContain('data-relays="${relayData}"')
    expect(renderers).toContain("encodeURIComponent(JSON.stringify(relays))")
    expect(mounter).toContain("parseProfileRelayHints")
    expect(mounter).toContain("relays: profileRelays")
  })

  it("keeps non-markdown profile mentions on the Budabit resolver with pointer relays", () => {
    const mention = readProjectFile("../components/ContentMention.svelte")

    expect(mention).toContain("deriveBudabitProfileDisplay")
    expect(mention).toContain("(value as any).relays")
    expect(mention).toContain(
      "pushModal(ProfileDetail, {pubkey: value.pubkey, url: relays[0], relays})",
    )
    expect(mention).not.toContain("deriveProfileDisplay")
  })

  it("keeps chat profile reads on the Budabit resolver with explicit relay hints", () => {
    const roomItem = readProjectFile("../components/RoomItem.svelte")
    const channelMessage = readProjectFile("../components/ChannelMessage.svelte")
    const chatMessage = readProjectFile("../components/ChatMessage.svelte")

    expect(roomItem).toContain("deriveBudabitProfileDisplay")
    expect(roomItem).toContain("relays: profileRelayHints")
    expect(channelMessage).toContain("deriveBudabitProfileDisplay")
    expect(channelMessage).toContain("relays: profileRelayHints")
    expect(channelMessage).toContain("url: profileRelayHints[0]")
    expect(chatMessage).toContain("deriveBudabitProfileDisplay")
  })

  it("keeps development diagnostics wired to profile and publish relay helpers", () => {
    const profileResolver = readProjectFile("./profile-resolver.ts")
    const communityRelays = readProjectFile("./community-relays.ts")
    const gitState = readProjectFile("./git-state.ts")
    const gitCommands = readProjectFile("./git-commands.ts")

    expect(profileResolver).toContain("logProfileLoadSummary")
    expect(profileResolver).toContain('"first-load"')
    expect(profileResolver).toContain('"improved-hints"')
    expect(communityRelays).toContain('category: "personal-user-data"')
    expect(gitState).toContain('category: "repo-announcement"')
    expect(gitCommands).toContain('category: "repo-scoped"')
  })

  it("does not use repo route relayUrl as a profile hint in repo views", () => {
    for (const path of [
      "../../routes/git/[id=naddr]/+page.svelte",
      "../../routes/git/[id=naddr]/issues/+page.svelte",
      "../../routes/git/[id=naddr]/prs/+page.svelte",
      "../../routes/git/[id=naddr]/prs/[prid]/+page.svelte",
      "../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte",
    ]) {
      const source = readProjectFile(path)

      if (!path.includes("prs/[prid]")) expect(source).toContain("repoCommunityProfileRelays")
      expect(source).not.toMatch(/<(ProfileCircle|ProfileLink|ProfileName)[^>]+url=\{relayUrl\}/s)
      expect(source).not.toMatch(/pushModal\(ProfileDetail,\s*\{[^}]*url:\s*relayUrl/s)
    }
  })
})
