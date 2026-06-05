import {describe, expect, it, vi} from "vitest"
import {PublishStatus} from "@welshman/net"
import {type Filter, type SignedEvent, type TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND, PROFILE_LIST_KIND} from "./community"
import {
  getNextReplacementCreatedAt,
  makeReplacementCurrentFilter,
  publishAndVerifyCommunityEvent,
  selectCurrentReplacementEvent,
  verifyCommunityEventReadback,
} from "./community-publish"

const pubkey = "a".repeat(64)
const relay = "wss://relay.example.com/"
const backupRelay = "wss://backup.example.com/"

const makeSignedEvent = (overrides: Partial<SignedEvent>): SignedEvent =>
  ({
    id: "event-id",
    pubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as SignedEvent

const makeTrustedEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  makeSignedEvent(overrides) as TrustedEvent

const makeLoader = (handler: (relays: string[], filters: Filter[]) => TrustedEvent[]) =>
  vi.fn(async (relays: string[], filters: Filter[]) => handler(relays, filters))

describe("community publish verification", () => {
  it("bumps replacement timestamps past existing local events", () => {
    expect(getNextReplacementCreatedAt([], 10)).toBe(10)
    expect(getNextReplacementCreatedAt([makeTrustedEvent({created_at: 10})], 10)).toBe(11)
    expect(getNextReplacementCreatedAt([makeTrustedEvent({created_at: 14})], 10)).toBe(15)
  })

  it("builds current replacement filters for community definition and profile lists", () => {
    expect(
      makeReplacementCurrentFilter(
        makeSignedEvent({kind: COMMUNITY_DEFINITION_KIND, pubkey, tags: []}),
      ),
    ).toEqual({kinds: [COMMUNITY_DEFINITION_KIND], authors: [pubkey], limit: 10})
    expect(
      makeReplacementCurrentFilter(
        makeSignedEvent({kind: PROFILE_LIST_KIND, pubkey, tags: [["d", "General"]]}),
      ),
    ).toEqual({kinds: [PROFILE_LIST_KIND], authors: [pubkey], "#d": ["General"], limit: 10})
    expect(makeReplacementCurrentFilter(makeSignedEvent({kind: 1}))).toBeUndefined()
  })

  it("selects the current replacement using Welshman replacement semantics", () => {
    const target = makeSignedEvent({
      id: "b".repeat(64),
      kind: PROFILE_LIST_KIND,
      created_at: 5,
      tags: [["d", "General"]],
    })
    const older = makeTrustedEvent({
      id: "a".repeat(64),
      kind: PROFILE_LIST_KIND,
      created_at: 4,
      tags: [["d", "General"]],
    })
    const unrelated = makeTrustedEvent({
      id: "c".repeat(64),
      kind: PROFILE_LIST_KIND,
      created_at: 6,
      tags: [["d", "Other"]],
    })

    expect(
      selectCurrentReplacementEvent(target, [older, unrelated, target as TrustedEvent])?.id,
    ).toBe(target.id)
  })

  it("verifies exact readback and replacement-current state on the relay", async () => {
    const event = makeSignedEvent({
      id: "b".repeat(64),
      kind: PROFILE_LIST_KIND,
      created_at: 5,
      tags: [["d", "General"]],
    })
    const older = makeTrustedEvent({
      id: "a".repeat(64),
      kind: PROFILE_LIST_KIND,
      created_at: 4,
      tags: [["d", "General"]],
    })
    const loadEvents = makeLoader((_relays, filters) => {
      if (filters[0].ids?.includes(event.id)) return [event as TrustedEvent]

      return [older, event as TrustedEvent]
    })

    await expect(
      verifyCommunityEventReadback({event, relays: [relay], label: "member list", loadEvents}),
    ).resolves.toEqual(event)
    expect(loadEvents).toHaveBeenCalledTimes(2)
  })

  it("rejects a readback when the relay still serves a newer replacement", async () => {
    const event = makeSignedEvent({
      id: "b".repeat(64),
      kind: PROFILE_LIST_KIND,
      created_at: 5,
      tags: [["d", "General"]],
    })
    const newer = makeTrustedEvent({
      id: "c".repeat(64),
      kind: PROFILE_LIST_KIND,
      created_at: 6,
      tags: [["d", "General"]],
    })
    const loadEvents = makeLoader((_relays, filters) => {
      if (filters[0].ids?.includes(event.id)) return [event as TrustedEvent]

      return [event as TrustedEvent, newer]
    })

    await expect(
      verifyCommunityEventReadback({event, relays: [relay], label: "member list", loadEvents}),
    ).rejects.toThrow("still serves a different replacement event")
  })

  it("publishes and verifies only the required relay before resolving", async () => {
    const event = makeSignedEvent({
      id: "b".repeat(64),
      kind: PROFILE_LIST_KIND,
      created_at: 5,
      tags: [["d", "General"]],
    })
    const publishEvent = vi.fn(async () => ({
      [relay]: {relay, status: PublishStatus.Success, detail: ""},
      [backupRelay]: {relay: backupRelay, status: PublishStatus.Timeout, detail: "timed out"},
    }))
    const loadEvents = makeLoader((relays, filters) => {
      expect(relays).toEqual([relay])
      if (filters[0].ids?.includes(event.id)) return [event as TrustedEvent]

      return [event as TrustedEvent]
    })
    const statuses: string[] = []

    await expect(
      publishAndVerifyCommunityEvent({
        event,
        relays: [relay, backupRelay],
        requiredRelay: relay,
        label: "member list",
        publishEvent,
        loadEvents,
        setStatus: status => statuses.push(status),
      }),
    ).resolves.toEqual(event)
    expect(statuses).toEqual(["Publishing member list...", "Verifying member list on relay..."])
  })
})
