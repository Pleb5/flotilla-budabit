import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("profile discoverability phase 1 baseline", () => {
  it("keeps the relay publishing policy reference available", () => {
    const policy = readProjectFile("../../../docs/architecture/Budabit-Relay-Publishing-Policy.md")

    expect(policy).toContain("Do not use repo relays for profiles")
    expect(policy).toContain("Personal User-Data Publication")
    expect(policy).toContain("Repo announcement")
    expect(policy).toContain("Read-Time Profile Discovery")
  })

  it("keeps ProfileDetail using url as the first relay hint and all hints for the route", () => {
    const source = readProjectFile("../components/ProfileDetail.svelte")

    expect(source).toContain("const relayHints = $derived(removeUndefined([url, ...relays]))")
    expect(source).toContain("const profileUrl = $derived(relayHints[0])")
    expect(source).toContain(
      "const fullProfilePath = $derived(makeProfilePath(pubkey, relayHints))",
    )
    expect(source).toContain(
      "const showInfo = () => pushModal(EventInfo, {url: profileUrl, event: $profile!.event})",
    )
  })

  it("keeps profile modal callers passing current url relay hints unchanged", () => {
    const profile = readProjectFile("../components/Profile.svelte")
    const link = readProjectFile("../components/ProfileLink.svelte")

    expect(profile).toContain("const relayHints = $derived(removeUndefined([url, ...relays]))")
    expect(profile).toContain(
      "pushModal(ProfileDetail, {pubkey, url: relayHints[0], relays: relayHints})",
    )
    expect(link).toContain("pushModal(ProfileDetail, {pubkey, url})")
    expect(link).toContain("<ProfileName {pubkey} {url} />")
  })

  it("does not use repo relay defaults in common profile read components", () => {
    for (const path of [
      "../components/Profile.svelte",
      "../components/ProfileCircle.svelte",
      "../components/ProfileDetail.svelte",
      "../components/ProfileInfo.svelte",
      "../components/ProfileLink.svelte",
      "../components/ProfileName.svelte",
    ]) {
      const source = readProjectFile(path)

      expect(source).not.toMatch(/\bGIT_RELAYS\b/)
      expect(source).not.toContain("getRepoAnnouncementRelays")
      expect(source).not.toContain("getRepoScopedRelays")
    }
  })
})
