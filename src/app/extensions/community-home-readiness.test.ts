import {describe, expect, it} from "vitest"
import {
  isCommunityHomeCoreReady,
  isCommunityHomeExtensionReady,
  isCompleteCommunityModeratorEvidence,
  type CommunityHomeCoreReadinessInput,
} from "./community-home-readiness"

const readyCore = (): CommunityHomeCoreReadinessInput => ({
  communityPubkey: "community",
  definitionPubkey: "community",
  expectedBootstrapKey: "viewer:community:relay",
  expectedPermissionKeyPrefix: "viewer:definition:relay:",
  bootstrapStatus: {
    key: "viewer:community:relay",
    loading: false,
    loaded: true,
  },
  permissionStatus: {
    communityPubkey: "community",
    key: "viewer:definition:relay:1",
    loading: false,
    loaded: true,
    hasCachedEvents: false,
  },
})

describe("community home readiness", () => {
  it("requires the current bootstrap and permission generations", () => {
    expect(isCommunityHomeCoreReady(readyCore())).toBe(true)
    expect(
      isCommunityHomeCoreReady({
        ...readyCore(),
        bootstrapStatus: {...readyCore().bootstrapStatus, key: "previous-viewer"},
      }),
    ).toBe(false)
    expect(
      isCommunityHomeCoreReady({
        ...readyCore(),
        permissionStatus: {...readyCore().permissionStatus, key: "viewer:previous-definition:1"},
      }),
    ).toBe(false)
  })

  it("accepts usable cached permissions or a terminal permission load", () => {
    expect(
      isCommunityHomeCoreReady({
        ...readyCore(),
        permissionStatus: {
          ...readyCore().permissionStatus,
          loading: true,
          loaded: false,
          hasCachedEvents: true,
        },
      }),
    ).toBe(true)
    expect(
      isCommunityHomeCoreReady({
        ...readyCore(),
        permissionStatus: {
          ...readyCore().permissionStatus,
          loading: false,
          loaded: false,
          hasCachedEvents: false,
        },
      }),
    ).toBe(false)
  })

  it("does not release on a community-definition failure", () => {
    expect(
      isCommunityHomeCoreReady({
        ...readyCore(),
        definitionPubkey: "",
        bootstrapStatus: {
          ...readyCore().bootstrapStatus,
          loaded: false,
          error: "Community definition unavailable",
        },
      }),
    ).toBe(false)
  })

  it("releases after rooms exist or the matching first catalog attempt settles", () => {
    const pending = {
      ...readyCore(),
      roomsPresent: false,
      expectedRoomCatalogKey: "catalog-current",
      firstRoomCatalogKey: "catalog-current",
      firstRoomCatalogTerminal: false,
    }

    expect(isCommunityHomeExtensionReady(pending)).toBe(false)
    expect(isCommunityHomeExtensionReady({...pending, roomsPresent: true})).toBe(true)
    expect(isCommunityHomeExtensionReady({...pending, firstRoomCatalogTerminal: true})).toBe(true)
    expect(
      isCommunityHomeExtensionReady({
        ...pending,
        firstRoomCatalogKey: "catalog-previous",
        firstRoomCatalogTerminal: true,
      }),
    ).toBe(false)
  })

  it("only accepts complete moderator evidence for the current key", () => {
    expect(
      isCompleteCommunityModeratorEvidence("current", {key: "current", status: "complete"}),
    ).toBe(true)
    expect(
      isCompleteCommunityModeratorEvidence("current", {key: "previous", status: "complete"}),
    ).toBe(false)
    expect(
      isCompleteCommunityModeratorEvidence("current", {key: "current", status: "loading"}),
    ).toBe(false)
    expect(
      isCompleteCommunityModeratorEvidence("current", {key: "current", status: "unresolved"}),
    ).toBe(false)
  })
})
