// @vitest-environment jsdom

import {beforeEach, describe, expect, it} from "vitest"
import {get} from "svelte/store"
import {
  blossomDashboardState,
  blossomSettings,
  buildBlossomServerGroups,
  defaultBlossomDashboardState,
  defaultBlossomSettings,
  flattenBlossomServerGroups,
  normalizeBlossomDashboardState,
  normalizeBlossomSettings,
  rememberBlossomCapability,
  rememberBlossomUpload,
  selectMemberCommunityBlossomRefs,
  updateBlossomSettings,
  updateBlossomUploadRecord,
  type BlossomUploadRecord,
} from "./blossom"
import {COMMUNITY_DEFINITION_KIND, PROFILE_LIST_KIND, parseCommunityDefinition} from "./community"
import type {TrustedEvent} from "@welshman/util"

const makeUpload = (id: string, updatedAt = 100): BlossomUploadRecord => ({
  id,
  createdAt: updatedAt,
  updatedAt,
  context: {type: "generic"},
  canonical: {
    url: `https://blossom.example/${"a".repeat(64)}.webp`,
    sha256: "a".repeat(64),
    size: 123,
    type: "image/webp",
  },
  optimizationMode: "auto",
  mirrorMode: "ask",
  mirrorJobs: [],
})

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: "a".repeat(64),
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

beforeEach(() => {
  localStorage.clear()
  blossomSettings.set(defaultBlossomSettings)
  blossomDashboardState.set(defaultBlossomDashboardState)
})

describe("blossom settings", () => {
  it("defaults to auto optimization and ask-before-mirroring", () => {
    expect(defaultBlossomSettings).toMatchObject({
      optimizationMode: "auto",
      mirrorMode: "ask",
      browserMirrorConsent: "ask",
      preferServerSideMirroring: true,
      publicEncryptionEnabled: false,
    })
    expect(defaultBlossomSettings.autoMirrorTargetGroups).toEqual([])
  })

  it("normalizes invalid stored settings back to safe defaults", () => {
    const normalized = normalizeBlossomSettings({
      optimizationMode: "invalid" as any,
      mirrorMode: "always-selected",
      browserMirrorConsent: "invalid" as any,
      preferServerSideMirroring: false,
      autoMirrorTargetGroups: ["personal", "bad", "personal"] as any,
      publicEncryptionEnabled: true as any,
    })

    expect(normalized).toEqual({
      ...defaultBlossomSettings,
      mirrorMode: "always-selected",
      preferServerSideMirroring: false,
      autoMirrorTargetGroups: ["personal"],
    })
  })

  it("updates the local settings store with normalized values", () => {
    updateBlossomSettings({
      optimizationMode: "client",
      browserMirrorConsent: "allow",
      autoMirrorTargetGroups: ["current-community", "manual"],
    })

    expect(get(blossomSettings)).toMatchObject({
      optimizationMode: "client",
      browserMirrorConsent: "allow",
      autoMirrorTargetGroups: ["current-community", "manual"],
    })
  })
})

describe("blossom dashboard state", () => {
  it("drops malformed upload and capability records", () => {
    const normalized = normalizeBlossomDashboardState({
      uploads: [makeUpload("ok"), {id: "bad", canonical: {url: "https://example.com"}} as any],
      capabilities: {
        good: {
          url: "https://blossom.example",
          checkedAt: 1,
          upload: "supported",
          media: "unsupported",
          mirror: "unknown",
        },
        bad: {url: ""},
      } as any,
    })

    expect(normalized.uploads.map(upload => upload.id)).toEqual(["ok"])
    expect(Object.keys(normalized.capabilities)).toEqual(["https://blossom.example"])
  })

  it("remembers uploads by id and keeps newest records first", () => {
    rememberBlossomUpload(makeUpload("older", 100))
    rememberBlossomUpload(makeUpload("newer", 200))
    rememberBlossomUpload({...makeUpload("older", 300), canonical: makeUpload("older").canonical})

    expect(get(blossomDashboardState).uploads.map(upload => upload.id)).toEqual(["older", "newer"])
    expect(get(blossomDashboardState).uploads[0].updatedAt).toBe(300)
  })

  it("updates existing upload records", () => {
    rememberBlossomUpload(makeUpload("upload"))
    updateBlossomUploadRecord("upload", record => ({
      ...record,
      mirrorJobs: [
        {
          id: "job",
          targetUrl: "https://mirror.example",
          targetGroup: "personal",
          method: "server-mirror",
          status: "queued",
          attempts: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }))

    expect(get(blossomDashboardState).uploads[0].mirrorJobs).toHaveLength(1)
  })

  it("remembers server capabilities keyed by url", () => {
    rememberBlossomCapability({
      url: "https://blossom.example",
      checkedAt: 10,
      upload: "supported",
      media: "supported",
      mirror: "unsupported",
    })

    expect(get(blossomDashboardState).capabilities["https://blossom.example"]).toMatchObject({
      media: "supported",
      mirror: "unsupported",
    })
  })
})

describe("blossom server sources", () => {
  it("builds grouped targets in priority order and deduplicates servers", () => {
    const groups = buildBlossomServerGroups({
      currentCommunity: {
        servers: ["https://community.example/", "https://shared.example"],
        communityPubkey: "c".repeat(64),
        communityName: "Community",
      },
      personalServers: ["https://personal.example", "https://shared.example/"],
      memberCommunities: [
        {
          communityPubkey: "d".repeat(64),
          relayHints: [],
          blossomServers: ["https://member.example", "notaurl"],
          writableSections: ["General"],
        },
      ],
      lastResortServers: ["https://fallback.example", "https://personal.example"],
    })

    expect(groups.currentCommunity.map(target => target.url)).toEqual([
      "https://community.example",
      "https://shared.example",
    ])
    expect(groups.personal.map(target => target.url)).toEqual(["https://personal.example"])
    expect(groups.memberCommunities.map(target => target.url)).toEqual([
      "https://member.example",
    ])
    expect(groups.lastResort.map(target => target.url)).toEqual(["https://fallback.example"])
    expect(flattenBlossomServerGroups(groups).map(target => target.group)).toEqual([
      "current-community",
      "current-community",
      "personal",
      "member-community",
      "last-resort",
    ])
  })

  it("selects communities where the user can publish to at least one section", () => {
    const userPubkey = "b".repeat(64)
    const memberListOwner = "c".repeat(64)
    const outsiderPubkey = "d".repeat(64)
    const memberDefinition = parseCommunityDefinition(
      makeEvent({
        id: "member-definition",
        pubkey: "e".repeat(64),
        created_at: 2,
        kind: COMMUNITY_DEFINITION_KIND,
        tags: [
          ["blossom", "https://member-blossom.example/"],
          ["content", "General"],
          ["k", "9", "room-message"],
          ["a", `${PROFILE_LIST_KIND}:${memberListOwner}:General`],
        ],
      }),
    )!
    const emptyDefinition = parseCommunityDefinition(
      makeEvent({
        id: "empty-definition",
        pubkey: "f".repeat(64),
        created_at: 2,
        kind: COMMUNITY_DEFINITION_KIND,
        tags: [
          ["blossom", "https://empty-blossom.example/"],
          ["content", "General"],
          ["k", "9", "room-message"],
          ["a", `${PROFILE_LIST_KIND}:${memberListOwner}:Other`],
        ],
      }),
    )!
    const profileList = makeEvent({
      id: "member-list",
      pubkey: memberListOwner,
      kind: PROFILE_LIST_KIND,
      tags: [
        ["d", "General"],
        ["p", userPubkey],
        ["p", outsiderPubkey],
      ],
    })

    expect(
      selectMemberCommunityBlossomRefs({
        author: userPubkey,
        definitions: [memberDefinition, emptyDefinition],
        profileListEvents: [profileList],
      }),
    ).toEqual([
      expect.objectContaining({
        communityPubkey: memberDefinition.pubkey,
        blossomServers: ["https://member-blossom.example"],
        writableSections: ["General"],
      }),
    ])
  })
})
