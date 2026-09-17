import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const source = readFileSync("src/app/components/CommunityLayout.svelte", "utf8")
const homeSource = readFileSync("src/routes/c/[community]/+page.svelte", "utf8")

describe("community layout request lifecycle", () => {
  it("guards every finite request terminal path by controller identity", () => {
    expect(source.match(/communityHistoryLoadController !== controller/g)).toHaveLength(2)
    expect(source.match(/communityFollowUpLoadController !== controller/g)).toHaveLength(2)
    expect(source.match(/communityDeleteLoadController !== controller/g)).toHaveLength(3)
  })

  it("keeps aborts quiet and schedules retryable failures", () => {
    expect(source).toContain(
      "controller.signal.aborted || communityHistoryLoadController !== controller",
    )
    expect(source).toContain(
      "controller.signal.aborted || communityFollowUpLoadController !== controller",
    )
    expect(source).toContain(
      "controller.signal.aborted || communityDeleteLoadController !== controller",
    )
    expect(source).toContain("communityHistoryRetryVersion += 1")
    expect(source).toContain("communityFollowUpRetryVersion += 1")
    expect(source).toContain("communityDeleteRetryVersion += 1")
  })

  it("holds maintenance until the home room catalog reaches a terminal state", () => {
    expect(source).toContain('$page.route.id === "/c/[community]"')
    expect(source).toContain('$activeCommunityRoomLoad.roomId !== ""')
    expect(homeSource).toContain("activeCommunityRoomLoad.set({")
    expect(homeSource).toContain("roomRootsFirstAttemptTerminal")
    expect(homeSource).toContain('clearActiveCommunityRoomLoad(communityAddress, "")')
  })

  it("bounds delete hydration without starving later maintenance lanes", () => {
    expect(source).toContain("COMMUNITY_DELETE_LOAD_TIMEOUT_MS")
    expect(source).toContain('maintenanceAdmission.settle(admissionKey, "deletes")')
    expect(source).toContain("if (communityDeleteLoadController !== controller) return")
    expect(source).toContain("controller.abort()")
    expect(source).toContain("scheduleRetry()")
  })
})
