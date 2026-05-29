// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("$app/environment", () => ({dev: true}))

import {
  logProfileLoadSummary,
  logPublishRelaySummary,
  resetDiagnosticsForTest,
  warnEmptyImageSource,
} from "./diagnostics"

describe("diagnostics", () => {
  beforeEach(() => {
    resetDiagnosticsForTest()
    vi.spyOn(console, "debug").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("logs profile load summaries without event contents", () => {
    logProfileLoadSummary({
      pubkey: "a".repeat(64),
      relays: ["wss://relay.example", "wss://relay.example", "wss://community.example"],
      reason: "improved-hints",
      force: true,
    })

    expect(console.debug).toHaveBeenCalledWith(
      "[budabit:profile] load",
      expect.objectContaining({
        pubkey: "aaaaaaaa...aaaaaaaa",
        reason: "improved-hints",
        force: true,
        relayCount: 2,
        relays: ["wss://relay.example", "wss://community.example"],
      }),
    )
  })

  it("logs publish relay counts by category", () => {
    logPublishRelaySummary({
      category: "personal-user-data",
      relays: ["wss://outbox.example", "wss://community.example"],
      baseRelays: ["wss://outbox.example"],
      activeCommunityRelays: ["wss://community.example"],
    })

    expect(console.debug).toHaveBeenCalledWith(
      "[budabit:publish] relays",
      expect.objectContaining({
        category: "personal-user-data",
        relayCount: 2,
        baseRelayCount: 1,
        activeCommunityRelayCount: 1,
      }),
    )
    expect(Object.keys(vi.mocked(console.debug).mock.calls[0][1] as object)).not.toContain("event")
    expect(Object.keys(vi.mocked(console.debug).mock.calls[0][1] as object)).not.toContain(
      "content",
    )
  })

  it("warns once per empty image source path", () => {
    warnEmptyImageSource("ImageIcon")
    warnEmptyImageSource("ImageIcon")
    warnEmptyImageSource("SafeAvatarImage")

    expect(console.warn).toHaveBeenCalledTimes(2)
    expect(console.warn).toHaveBeenCalledWith("[budabit:image] empty source", {
      component: "ImageIcon",
      source: "src",
    })
    expect(console.warn).toHaveBeenCalledWith("[budabit:image] empty source", {
      component: "SafeAvatarImage",
      source: "src",
    })
  })
})
