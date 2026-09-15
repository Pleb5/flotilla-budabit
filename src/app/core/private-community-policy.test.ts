import {afterEach, describe, expect, it, vi} from "vitest"
import {getPublicKey, finalizeEvent} from "nostr-tools"
import {Repository, publish, publishOne, requestOne} from "@welshman/net"
import {publishThunk, repository, pubkey} from "@welshman/app"
import {
  buildCommunityDefinition,
  parseCommunityDefinition,
  updateCommunityDefinition,
} from "./community-protocol"
import {
  assertPrivatePublicationDestinations,
  assertPrivateEventScope,
  assertPrivateReadDestinations,
  supportsMemberOnlyReads,
  registerPrivateCommunity,
  markPrivateEvent,
  assertPublicCommunityOperation,
} from "./private-community-policy"
import {installPrivateCommunityBoundary} from "./private-community-boundary"
import {publishPrivateCommunityEvent} from "./private-community-publish"
import {prepareCommunityReaderEligibility} from "./community-read-access"

const key = new Uint8Array(32).fill(29),
  owner = getPublicKey(key),
  community = "a".repeat(64)
const relay = "wss://private-policy.test/",
  outside = "wss://public-policy.test/"
const template = buildCommunityDefinition({
  communityId: community,
  name: "Members",
  relays: [relay],
  readAccess: "members",
  sections: [{name: "General", kinds: [{kind: 1}], profileLists: []}],
})
const event = finalizeEvent({...template, created_at: 100}, key)
const definition = parseCommunityDefinition(event)!
const claim = {
  limitation: {auth_required: true},
  budabit: {read_control: {version: 1, mode: "members", scope: "relay"}},
}
afterEach(() => {
  vi.useRealTimers()
  pubkey.set(undefined)
})

describe("signed private intent", () => {
  it("accepts version-2 membership only with the generic REQ-admission/recheck capability", () => {
    const profile = {
      limitation: {auth_required: true},
      budabit: {read_control: {version: 2, mode: "members", scope: "relay"}},
      read_policy: {version: 1, admission: "req", consistency: "eventual", recheck_seconds: 5},
    }
    expect(supportsMemberOnlyReads(profile)).toBe(true)
    expect(
      assertPrivatePublicationDestinations(definition, [relay], new Map([[relay, profile]])),
    ).toEqual([relay])
    for (const change of [
      {version: 2},
      {admission: "event"},
      {consistency: "unknown"},
      {recheck_seconds: 0},
      {recheck_seconds: 301},
      {recheck_seconds: true},
      {recheck_seconds: "5"},
    ])
      expect(
        supportsMemberOnlyReads({...profile, read_policy: {...profile.read_policy, ...change}}),
      ).toBe(false)
  })
  it("builds/parses and preserves intent across metadata and full settings rebuilds", () => {
    expect(definition.readAccess).toBe("members")
    expect(updateCommunityDefinition(definition, {name: "Renamed"}).tags).toContainEqual([
      "read-access",
      "members",
    ])
    const updated = updateCommunityDefinition(
      definition,
      {name: "Renamed"},
      {replacement: template},
    )
    expect(updated.tags.filter(tag => tag[0] === "read-access")).toEqual([
      ["read-access", "members"],
    ])
    const publicTemplate = {
      ...template,
      tags: template.tags.filter(tag => tag[0] !== "read-access"),
    }
    expect(
      updateCommunityDefinition(definition, {}, {replacement: publicTemplate}).tags,
    ).toContainEqual(["read-access", "members"])
  })
  it("ignores unknown/duplicate/malformed extension values without invalidating base definitions; publication still blocks", () => {
    for (const tags of [
      [["read-access", "future"]],
      [
        ["read-access", "members"],
        ["read-access", "members"],
      ],
      [["read-access", "members", "extra"]],
    ]) {
      const parsed = parseCommunityDefinition({
        ...event,
        tags: [...tags, ...event.tags.filter(tag => tag[0] !== "read-access")],
      })!
      expect(parsed).toBeTruthy()
      expect(parsed.readAccess).toBeUndefined()
      expect(() =>
        assertPrivatePublicationDestinations(parsed, [relay], new Map([[relay, claim]])),
      ).toThrow()
      expect(() => assertPublicCommunityOperation(parsed.event)).toThrow()
    }
  })
  it("requires the actual version/members/relay claim AND auth_required", () => {
    for (const profile of [
      null,
      {},
      {limitation: {auth_required: true}},
      {budabit: {read_control: {}}},
      {...claim, limitation: {}},
      {...claim, budabit: {read_control: {version: 2, mode: "members", scope: "relay"}}},
      {...claim, budabit: {read_control: {version: 1, mode: "any", scope: "relay"}}},
    ])
      expect(supportsMemberOnlyReads(profile)).toBe(false)
    expect(supportsMemberOnlyReads(claim)).toBe(true)
    expect(
      assertPrivatePublicationDestinations(definition, [relay], new Map([[relay, claim]])),
    ).toEqual([relay])
    expect(() =>
      assertPrivatePublicationDestinations(
        definition,
        [relay, outside],
        new Map([
          [relay, claim],
          [outside, claim],
        ]),
      ),
    ).toThrow()
  })
})

describe("pre-side-effect private boundary", () => {
  it.each([
    "admission",
    "git-indexer",
    "permalink-union",
    "mixed-target",
    "preference",
    "roster",
    "recovery",
  ])(
    "blocks %s private fanout before signing, thunks, adapter creation, or repository insertion",
    async flow => {
      registerPrivateCommunity(definition.pointer, [relay])
      const tagged = {
        kind: flow === "preference" ? 30078 : 7,
        tags: [
          ["a", definition.pointer.address],
          ["h", community],
        ],
        content: "private fixture",
      }
      const restore = installPrivateCommunityBoundary(),
        adapter = vi.fn()
      const signed = finalizeEvent({...tagged, created_at: 101}, key)
      try {
        expect(() => publishThunk({event: tagged, relays: [relay, outside]})).toThrow(/Private/)
        await expect(
          publish({event: signed, relays: [relay, outside], context: {getAdapter: adapter}}),
        ).rejects.toThrow(/Private/)
        await expect(
          publishOne({event: signed, relay: outside, context: {getAdapter: adapter}}),
        ).rejects.toThrow(/Private/)
        const onClosed = vi.fn(),
          onEose = vi.fn()
        expect(
          await requestOne({
            relay: outside,
            filters: [{"#a": [definition.pointer.address]}],
            context: {getAdapter: adapter},
            onClosed,
            onEose,
          }),
        ).toEqual([])
        expect(onClosed).toHaveBeenCalledWith(
          "restricted: request blocked by local privacy policy",
          outside,
        )
        expect(onEose).not.toHaveBeenCalled()
        expect(repository.publish(signed)).toBe(false)
        expect(adapter).not.toHaveBeenCalled()
        expect(() =>
          assertPrivateEventScope({...tagged, tags: [["h", "b".repeat(64)]]}, definition),
        ).toThrow()
      } finally {
        restore()
      }
    },
  )
  it("rejects unsafe private publisher targets before signing and cancels identity changes", async () => {
    const sign = vi.fn(),
      identity = vi.fn(() => owner)
    await expect(
      publishPrivateCommunityEvent({
        definition,
        event: template,
        relays: [outside],
        profiles: new Map([[outside, claim]]),
        sockets: new Map(),
        identity: owner,
        currentIdentity: identity,
        signal: new AbortController().signal,
        sign,
      }),
    ).rejects.toThrow()
    expect(sign).not.toHaveBeenCalled()
  })
  it("revalidates shared delayed batches at final insertion and clears private deferred intake", async () => {
    vi.useFakeTimers()
    const normal = finalizeEvent(
      {kind: 1, tags: [], content: "later-private", created_at: 102},
      key,
    )
    const restore = installPrivateCommunityBoundary()
    try {
      repository.publish(normal, {deferMs: 100})
      markPrivateEvent(normal, [relay])
      await vi.advanceTimersByTimeAsync(200)
      expect(repository.query([{ids: [normal.id]}])).toEqual([])
      const privateRepo = new Repository({deletionAwareReplaceables: true})
      privateRepo.publish(normal, {deferMs: 100})
      privateRepo.clear()
      await vi.advanceTimersByTimeAsync(200)
      expect(privateRepo.dump()).toEqual([])
      expect(() => assertPrivateReadDestinations([{ids: [normal.id]}], [outside])).toThrow()
    } finally {
      restore()
    }
  })
})

describe("deletion-aware retained private authority", () => {
  it("applies current grant e-only deletion, even arriving before its body, without resurrecting prior grants", () => {
    const older = finalizeEvent(
      {
        kind: 30000,
        created_at: 99,
        tags: [
          ["d", `${community}-general`],
          ["p", owner],
        ],
        content: "",
      },
      key,
    )
    const current = finalizeEvent(
      {
        ...older,
        created_at: 100,
        tags: [
          ["d", `${community}-general`],
          ["p", "2".repeat(64)],
        ],
      },
      key,
    )
    const deletion = finalizeEvent(
      {kind: 5, created_at: 101, tags: [["e", current.id]], content: ""},
      key,
    )
    for (const events of [
      [older, current, deletion],
      [deletion, older, current],
      [current, deletion, older],
    ]) {
      const repo = new Repository({deletionAwareReplaceables: true})
      for (const event of events) repo.publish(event)
      expect(repo.query([{kinds: [30000]}])).toEqual([])
      const scopedDefinition = {
        ...definition,
        sections: [
          {
            ...definition.sections[0],
            profileLists: [{address: `30000:${owner}:${community}-general`}],
          },
        ],
      }
      const canRead = () =>
        prepareCommunityReaderEligibility({
          community: definition.pointer,
          definition: scopedDefinition,
          profileListEvents: repo.query([{}]),
          ready: true,
        })("2".repeat(64))
      expect(canRead()).toBe(false)
      const fresh = finalizeEvent({...current, created_at: 102}, key)
      repo.publish(fresh)
      expect(repo.query([{kinds: [30000]}]).map(event => event.id)).toEqual([fresh.id])
      expect(canRead()).toBe(true)
    }
  })
  it("rejects deletion by another author and tie-breaks equal-time replacements by lower ID", () => {
    const a = finalizeEvent(
      {kind: 30000, created_at: 100, tags: [["d", `${community}-general`]], content: "a"},
      key,
    )
    const b = finalizeEvent({...a, content: "b"}, key)
    const deletion = finalizeEvent(
      {
        kind: 5,
        created_at: 101,
        tags: [
          ["e", a.id],
          ["e", b.id],
        ],
        content: "",
      },
      new Uint8Array(32).fill(30),
    )
    for (const events of [
      [a, b, deletion],
      [b, a, deletion],
    ]) {
      const repo = new Repository({deletionAwareReplaceables: true})
      for (const event of events) repo.publish(event)
      expect(repo.query([{kinds: [30000]}]).map(event => event.id)).toEqual([
        [a.id, b.id].sort()[0],
      ])
    }
  })
})
