import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
const dense = (source: string) => source.replace(/\s+/g, "")

describe("authoritative repository loading scope", () => {
  it("uses route hints only for kind 30617 discovery", () => {
    const routeLoad = dense(readProjectFile("../../routes/git/[id=naddr]/+layout.ts"))
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/+layout.svelte"))
    const initialLoad = layout.slice(
      layout.indexOf("//Useeffectonlyfordataloading"),
      layout.indexOf("constflushPendingRepoAddressLoads"),
    )
    const announcementLoad = initialLoad.slice(
      initialLoad.indexOf("constannouncementFilters"),
      initialLoad.indexOf("constrelayListFromUrl"),
    )

    expect(routeLoad).toContain("constannouncementDiscoveryRelays=Array.from(")
    expect(routeLoad).toContain(
      "newSet([...naddrRelays,...targetOutboxRelays,...configuredFallbackRelays])",
    )
    expect(layout).toContain("getRepoScopedRelays(re,{pubkey:repoPubkey,identifier:repoName})")
    expect(announcementLoad).toContain("kinds:[GIT_REPO_ANNOUNCEMENT]")
    expect(announcementLoad).not.toContain("GIT_REPO_STATE")
    expect(initialLoad).toContain("constrelayListFromUrl=$repoRelaysStore")
    expect(initialLoad).toContain("if(relayListFromUrl.length===0)")
    expect(initialLoad).toContain("kinds:[GIT_REPO_STATE]")
  })

  it("does not pass naddr hints into child repository activity loading", () => {
    for (const path of [
      "../../routes/git/[id=naddr]/issues/+page.svelte",
      "../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte",
      "../../routes/git/[id=naddr]/prs/[prid]/+page.svelte",
    ]) {
      const source = readProjectFile(path)

      expect(source).toContain("getRepoScopedRelays(")
      expect(source).not.toMatch(/getRepoScopedRelays\([^)]*naddrRelays/)
    }

    const testRoute = readProjectFile("../../routes/git/[id=naddr]/test/+page.svelte")
    expect(testRoute).toContain("REPO_RELAYS_KEY")
    expect(testRoute).not.toContain("($page.data as any)?.url")
    expect(testRoute).not.toContain("wss://relay.budabit.club")
  })

  it("partitions owned repository state loads without Git relay fallback", () => {
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/+layout.svelte"))
    const ownedStateLoad = layout.slice(
      layout.indexOf("constmyRepoStateLoadScopes"),
      layout.indexOf("constbuildRepoBranchUpdate"),
    )

    expect(ownedStateLoad).toContain("getOwnedRepoStateLoadScopes(latestMyRepos,$pubkey)")
    expect(ownedStateLoad).toContain("getOwnedRepoStateLoadPlans(latestMyRepos,$pubkey)")
    expect(ownedStateLoad).toContain("for(constplanofplans)")
    expect(ownedStateLoad).toContain('"#d":plan.repoIds')
    expect(ownedStateLoad).toContain("load({relays:[plan.relay],filters:[filter]})")
    expect(ownedStateLoad).not.toContain("GIT_RELAYS")
  })

  it("preserves one per-relay live owner and the existing filter topology", () => {
    const source = readProjectFile("../../routes/git/[id=naddr]/+layout.svelte")
    const layout = dense(source)
    const liveFilters = layout.slice(
      layout.indexOf("constbuildRepoLiveFilters"),
      layout.indexOf("//Useeffectonlyfordataloading"),
    )

    expect(source.match(/lifetime:\s*"live"/g)).toHaveLength(1)
    expect(source.match(/owner:\s*"repo-foreground"/g)).toHaveLength(1)
    expect(layout).toContain("registerRepoLiveOwnership(address,url)")
    expect(layout).toContain("relays:[url],signal:controller.signal,filters")
    expect(liveFilters).toContain('"#a":addressChunk')
    expect(liveFilters).toContain('"#E":rootChunk')
    expect(liveFilters).toContain('"#e":rootChunk')
    expect(liveFilters).toContain('"#p":[viewer]')
  })

  it("does not initialize repository extensions without relay authority", () => {
    const extensionPage = readProjectFile(
      "../../routes/git/[id=naddr]/extensions/[extId]/+page.svelte",
    )

    expect(extensionPage).toContain("REPO_RELAYS_KEY")
    expect(extensionPage).toContain("hasRepoRelayAuthority")
    expect(extensionPage).toContain("Repository Relays Unavailable")
    expect(extensionPage).not.toContain("@welshman/router")
    expect(extensionPage).not.toContain("wss://relay.budabit.club/")
    expect(extensionPage).not.toContain("wss://nos.lol/")
  })
})
