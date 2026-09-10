import {describe, expect, it, vi} from "vitest"
import {createRepoAnnouncementEvent, createRepoStateEvent} from "@nostr-git/core/events"
import {createForkRepoPublisher, createRepoCreationPublisher} from "./fork-publication"
import {requireRepoPublicationScope} from "./repo-publication"

const sourceOwner = "a".repeat(64)
const owner = "b".repeat(64)
const relay = "wss://fork.test/"
const identifier = "my-great-repo"
const repoAddress = `30617:${owner}:${identifier}`
const announcement = createRepoAnnouncementEvent({repoId: identifier, relays: [relay]})
const state = createRepoStateEvent({repoId: identifier, head: "main", refs: []})

describe("creation/recovery route publication", () => {
  const createPublisher = createRepoCreationPublisher
  it("shares the destination guard with the fork route", () => {
    expect(createForkRepoPublisher).toBe(createRepoCreationPublisher)
  })
  it("delivers announcement and state at the approved destination, not the source", async () => {
    const publish = vi.fn(async (event, relays, options) => {
      options.assertCurrent()
      const signed = {...event, pubkey: owner, id: "fixture", sig: "fixture-only"}
      requireRepoPublicationScope({event: signed, relays, repoAddress: options.repoAddress})
      return {
        event: signed,
        ackedRelays: relays,
        failedRelays: [],
        successCount: relays.length,
        hasRelayOutcomes: true,
        relayOutcomes: [],
      }
    })
    const publisher = createPublisher({
      ownerPubkey: owner,
      getActivePubkey: () => owner,
      transport: {publish},
    })
    expect(() =>
      requireRepoPublicationScope({
        event: state,
        relays: [relay],
        repoAddress: `30617:${sourceOwner}:stable-id`,
      }),
    ).toThrow(/authoritative repository/)
    for (const event of [announcement, state]) {
      const result = await publisher(event, {relays: [relay], repoAddress})
      expect(result.ackedRelays).toEqual([relay])
      expect(result.event.tags).toContainEqual(["d", identifier])
    }
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it("keeps same-coordinate hosting valid", async () => {
    const publish = vi.fn(async event => ({
      event,
      ackedRelays: [relay],
      failedRelays: [],
      successCount: 1,
      hasRelayOutcomes: true,
      relayOutcomes: [],
    }))
    const publisher = createPublisher({
      ownerPubkey: owner,
      getActivePubkey: () => owner,
      transport: {publish},
    })
    await publisher({...announcement, pubkey: owner}, {relays: [relay], repoAddress})
    expect(publish).toHaveBeenCalledOnce()
  })

  it("rejects a missing destination, wrong owner, or mismatched metadata before delivery", async () => {
    const publish = vi.fn()
    const publisher = createPublisher({
      ownerPubkey: owner,
      getActivePubkey: () => owner,
      transport: {publish},
    })
    await expect(publisher(state, {relays: [relay]})).rejects.toThrow(/approved destination/)
    await expect(
      publisher(state, {relays: [relay], repoAddress: `30617:${sourceOwner}:${identifier}`}),
    ).rejects.toThrow(/approved destination/)
    for (const event of [
      {...state, pubkey: sourceOwner},
      {...state, tags: [["d", "other"]]},
      {...state, tags: [...state.tags, ["d", identifier]]},
      {...state, kind: 1},
    ]) {
      await expect(
        publisher(event as typeof state, {relays: [relay], repoAddress}),
      ).rejects.toThrow(/approved destination/)
    }
    expect(publish).not.toHaveBeenCalled()
  })

  it("rechecks the captured account after asynchronous signing", async () => {
    let active = owner
    const deliver = vi.fn()
    const publish = vi.fn(async (event, _relays, options) => {
      active = sourceOwner
      options.assertCurrent()
      deliver()
      return {
        event,
        ackedRelays: [relay],
        failedRelays: [],
        successCount: 1,
        hasRelayOutcomes: true,
        relayOutcomes: [],
      }
    })
    const publisher = createPublisher({
      ownerPubkey: owner,
      getActivePubkey: () => active,
      transport: {publish},
    })
    await expect(publisher(state, {relays: [relay], repoAddress})).rejects.toThrow(
      /account changed/,
    )
    expect(deliver).not.toHaveBeenCalled()
    await expect(publisher(state, {relays: [relay], repoAddress})).rejects.toThrow(
      /account changed/,
    )
    expect(publish).toHaveBeenCalledOnce()
  })

  it("forwards the asynchronous recovery freshness guard to the transport", async () => {
    const assertFresh = vi.fn(async () => {
      throw new Error("Owner metadata changed")
    })
    const publish = vi.fn(async (_event, _relays, options) => {
      await options.assertFresh()
      throw new Error("must not deliver")
    })
    const publisher = createPublisher({
      ownerPubkey: owner,
      getActivePubkey: () => owner,
      transport: {publish},
    })
    await expect(publisher(state, {relays: [relay], repoAddress, assertFresh})).rejects.toThrow(
      "Owner metadata changed",
    )
    expect(assertFresh).toHaveBeenCalledOnce()
  })
})
