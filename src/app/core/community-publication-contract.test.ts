import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("strict community publication source contracts", () => {
  it("uses definition-only relays in direct community route publishers", () => {
    const routes = [
      "../../routes/c/[community]/+page.svelte",
      "../../routes/c/[community]/threads/create/+page.svelte",
      "../../routes/c/[community]/threads/[thread]/+page.svelte",
      "../../routes/c/[community]/rooms/[room]/+page.svelte",
      "../../routes/c/[community]/goals/create/+page.svelte",
      "../../routes/c/[community]/calendar/create/+page.svelte",
      "../../routes/c/[community]/calendar/[event]/+page.svelte",
      "../../routes/c/[community]/permalinks/+page.svelte",
      "../../routes/c/[community]/git/+page.svelte",
    ]

    for (const route of routes) {
      const source = readProjectFile(route)

      expect(source, route).toContain("const relays = $activeCommunityPublishRelays")
    }
  })

  it("keeps read relays separate from action relays on community social surfaces", () => {
    const routes = [
      "../../routes/c/[community]/threads/+page.svelte",
      "../../routes/c/[community]/threads/[thread]/+page.svelte",
      "../../routes/c/[community]/rooms/[room]/+page.svelte",
      "../../routes/c/[community]/goals/+page.svelte",
      "../../routes/c/[community]/goals/[goal]/+page.svelte",
      "../../routes/c/[community]/calendar/+page.svelte",
      "../../routes/c/[community]/calendar/[event]/+page.svelte",
    ]

    for (const route of routes) {
      const source = readProjectFile(route)

      expect(source, route).toContain("$activeCommunityRelays")
      expect(source, route).toContain("$activeCommunityPublishRelays")
    }
  })

  it("passes explicit relay arrays through report and delete menus", () => {
    const eventMenu = readProjectFile("../components/EventMenu.svelte")
    const report = readProjectFile("../components/Report.svelte")
    const threadActions = readProjectFile("../components/ThreadActions.svelte")
    const calendarActions = readProjectFile("../components/CalendarEventActions.svelte")

    expect(eventMenu).toContain("pushModal(Report, {url, event, relays, repoAddress})")
    expect(eventMenu).toContain(
      "pushModal(EventDeleteConfirm, {url, event, noun, relays, repoAddress})",
    )
    expect(report).toContain("const publishRelays = normalizeRelays(relays)")
    expect(threadActions).toContain("publishSocialDelete({url, relays: actionRelays, event})")
    expect(calendarActions).toContain("publishSocialDelete({url, relays: actionRelays, event})")
  })

  it("does not broaden stars, badges, or widgets beyond definition relays", () => {
    const star = readProjectFile("../components/community/CommunityStarButton.svelte")
    const badges = readProjectFile("../../routes/c/[community]/badges/+page.svelte")
    const badgeAward = readProjectFile("../components/CommunityBadgeAwardForm.svelte")
    const widgets = readProjectFile("../../routes/c/[community]/widgets/+page.svelte")
    const explore = readProjectFile("../../routes/explore/+page.svelte")

    expect(star).toContain(
      "publishRelayHints === undefined ? relays : normalizeRelays(publishRelayHints)",
    )
    expect(badges).toContain("relays: badgePublishRelays")
    expect(badgeAward).toContain("relays: badgePublishRelays")
    expect(widgets).toContain("const baseRelays: string[] = []")
    expect(widgets).not.toContain("SMART_WIDGET_RELAYS")
    expect(widgets).not.toContain("Router.get().FromUser()")
    expect(explore).toContain("publishRelayHints={item.publishRelayHints}")
    expect(explore).toContain("getLoadedCommunityPublishRelays")
  })
})
