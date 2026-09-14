import {describe, expect, it, vi} from "vitest"
vi.mock("@nostr-git/ui", async () => {
  const {writable} = await import("svelte/store")
  return {graspServersStore: writable([])}
})
import {finalizeEvent} from "nostr-tools"
import {buildCommunityDefinition, parseCommunityDefinition} from "./community-protocol"
import {registerPrivateCommunity, markPrivateEvent} from "./private-community-policy"
import {
  getProfileCommunityRelaysFromRefs,
  getScopedCommunityPublishRelays,
} from "./community-relays"
import {getRepoAnnouncementPublishRelays} from "./git-state"
import {renounceCommunity, rejoinCommunity} from "./community-renunciations"
import {verifyCommunityEventReadback} from "./community-publish"
import {publishPermalinkToDestinations} from "../util/permalink-publishing"
import {getWidgetTargetPublishRelays} from "../extensions/widget-targeting"
import {startPublication} from "./publication-operations"

const key = new Uint8Array(32).fill(31),
  relay = "wss://fanout-private.test/"
const event = finalizeEvent(
  {
    ...buildCommunityDefinition({
      communityId: "f".repeat(64),
      name: "Private",
      readAccess: "members",
      relays: [relay],
      sections: [{name: "General", kinds: [{kind: 1}], profileLists: []}],
    }),
    created_at: 100,
  },
  key,
)
const definition = parseCommunityDefinition(event)!
registerPrivateCommunity(definition.pointer, [relay])

describe("actual public fanout entry points", () => {
  it("refuses Git indexer and mixed community destination calculation", () => {
    expect(() =>
      getRepoAnnouncementPublishRelays({
        communityIds: [definition.communityId],
        gitIndexerRelays: ["wss://indexer.test"],
      }),
    ).toThrow(/Private/)
    expect(() => getScopedCommunityPublishRelays([{communityId: definition.communityId}])).toThrow(
      /Private/,
    )
  })
  it("refuses permalink original before personal publication and widget original before targeting", () => {
    expect(() =>
      publishPermalinkToDestinations({
        permalink: {} as any,
        relays: ["wss://public.test"],
        communityOptions: [],
        selection: {personal: true, communityAddresses: [definition.pointer.address]},
      }),
    ).toThrow(/Private/)
    expect(() =>
      getWidgetTargetPublishRelays({
        baseRelays: ["wss://public.test"],
        communityOptions: [],
        communityAddresses: [definition.pointer.address],
      }),
    ).toThrow(/Private/)
  })
  it("omits private groups from roster/profile hydration and blocks preference mutation before encryption", async () => {
    expect(
      getProfileCommunityRelaysFromRefs([{community: definition.pointer, definition}]),
    ).toEqual([])
    await expect(renounceCommunity(definition.pointer)).rejects.toThrow(/Private/)
    await expect(rejoinCommunity(definition.pointer)).rejects.toThrow(/Private/)
  })
  it("blocks admission review fanout before thunk creation and exact recovery before any loader", async () => {
    const review = {kind: 7, tags: [["a", definition.pointer.address]], content: "+"}
    expect(() =>
      startPublication({
        event: review,
        relays: [relay, "wss://applicant.test"],
        label: "application decision",
        preview: "none",
        semanticKey: "fixture",
      }),
    ).toThrow(/Private/)
    const privateEvent = finalizeEvent(
      {kind: 1, tags: [], content: "private body", created_at: 101},
      key,
    )
    markPrivateEvent(privateEvent, [relay])
    const loadEvents = vi.fn()
    await expect(
      verifyCommunityEventReadback({
        event: privateEvent,
        relays: ["wss://outbox.test"],
        label: "recovery",
        loadEvents,
      }),
    ).rejects.toThrow(/Private/)
    expect(loadEvents).not.toHaveBeenCalled()
  })
})
