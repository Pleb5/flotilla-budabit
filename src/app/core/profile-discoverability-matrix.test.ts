import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
const compact = (source: string) => source.replace(/\s+/g, " ")
const dense = (source: string) => source.replace(/\s+/g, "")

describe("profile discoverability test matrix", () => {
  it("covers bare and hinted profile route loading", () => {
    const resolver = readProjectFile("./profile-resolver.ts")
    const resolverTests = readProjectFile("./profile-resolver.test.ts")

    expect(resolver).toContain("INDEXER_RELAYS")
    expect(resolver).toContain("getPubkeyOutboxRelays")
    expect(resolver).toContain("loadProfile")
    expect(resolverTests).toContain("uses indexer-backed Welshman loadProfile")
    expect(resolverTests).toContain("force-loads a missing profile when new relay hints appear")
    expect(resolverTests).toContain(
      "force-loads derived missing profiles when fixed relay hints improve",
    )
  })

  it("covers community profile reads and banned community fanout exclusion", () => {
    const communityHints = readProjectFile("./community-profile-hints.test.ts")
    const membershipTests = readProjectFile("./community-membership.test.ts")

    expect(communityHints).toContain("passes scoped community profile relays")
    expect(communityHints).toContain("makes member avatars open profiles")
    expect(membershipTests).toContain("excludes person-banned non-admin refs")
    expect(membershipTests).toContain("returns relay hints only for eligible active community refs")
  })

  it("covers explicit personal update fanout without membership-change backfill", () => {
    const personalTests = readProjectFile("./personal-user-data-relays.test.ts")
    const policy = readProjectFile("../../../docs/architecture/Budabit-Relay-Publishing-Policy.md")

    expect(personalTests).toContain(
      "adds active community relays to explicit personal command updates",
    )
    expect(personalTests).toContain("adds active community relays to settings list saves")
    expect(personalTests).toContain("adds active community relays to profile badge")
    expect(policy).toContain("Do not publish these events to community relays merely because")
  })

  it("covers profile and messaging relay update fanout", () => {
    const commands = dense(readProjectFile("./commands.ts"))

    expect(commands).toContain(
      "relays:getUserDataPublishRelays([url,...INDEXER_RELAYS,...Router.get().FromUser().getUrls(),])",
    )
    expect(commands).toContain(
      "relays:getUserDataPublishRelays([...INDEXER_RELAYS,...Router.get().FromUser().getUrls()])",
    )
  })

  it("covers repo announcement and repo-scoped event relay boundaries", () => {
    const gitStateTests = readProjectFile("./git-state.test.ts")
    const gitCommandsTests = readProjectFile("./git-commands.test.ts")
    const communityGitPage = dense(readProjectFile("../../routes/c/[community]/git/+page.svelte"))
    const gitPage = dense(readProjectFile("../../routes/git/+page.svelte"))
    const repoLayout = dense(readProjectFile("../../routes/git/[id=naddr]/+layout.svelte"))

    expect(gitStateTests).toContain("adds only h-tagged community relays")
    expect(gitStateTests).toContain(
      "derives scoped community relay targets from repo announcement h tags",
    )
    expect(gitCommandsTests).toContain("publishes comments only to provided relays")
    expect(gitCommandsTests).toContain("publishes issues only to provided repo relays")
    expect(gitCommandsTests).toContain("publishes statuses only to provided repo relays")
    expect(communityGitPage).toContain("getRepoAnnouncementPublishRelays")
    expect(communityGitPage).toContain("relays:announcementRelays,event:repoEvent")
    expect(gitPage).toContain("constdefaultRepoRelays=$state<string[]>([...GIT_RELAYS])")
    expect(repoLayout).not.toContain("repoRelays.length>0?repoRelays:GIT_RELAYS")
  })

  it("covers missing and slow profile rendering fallbacks", () => {
    const emptyImageTests = readProjectFile("./empty-image-sources.test.ts")
    const resolverTests = readProjectFile("./profile-resolver.test.ts")
    const profileCircle = compact(readProjectFile("../components/ProfileCircle.svelte"))

    expect(emptyImageTests).toContain("uses profile avatar fallback")
    expect(resolverTests).toContain("updates display stores when a slow profile load arrives")
    expect(profileCircle).toContain("ImageIcon")
    expect(profileCircle).toContain("UserRounded")
  })
})
