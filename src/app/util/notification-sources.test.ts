// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"
import {get, readable} from "svelte/store"
import {getPublicKey, nip19} from "nostr-tools"
import {
  GIT_COMMENT,
  GIT_ISSUE,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_REPO_ANNOUNCEMENT,
  GIT_STATUS_CLOSED,
} from "@nostr-git/core/events"
import type {TrustedEvent} from "@welshman/util"
import {
  COMMENT,
  DELETE,
  EVENT_DATE,
  EVENT_TIME,
  MESSAGE,
  REACTION,
  THREAD,
  ZAP_GOAL,
  ZAP_RESPONSE,
} from "@welshman/util"
import type {Chat} from "@app/core/state"
import type {ActiveUserCommunityRef} from "@app/core/community-membership"
import {
  COMMUNITY_SECTION_CALENDAR,
  COMMUNITY_SECTION_GENERAL,
  COMMUNITY_SECTION_GOALS,
  COMMUNITY_SECTION_THREADS,
  FORM_RESPONSE_KIND,
  FORM_TEMPLATE_KIND,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  buildCommunityDefinition,
  buildTargetedPublication,
  makeCommunityAuthorityTags,
  makeCommunityPointer,
} from "@app/core/community"
import {COMMUNITY_FORM_REVIEW_KIND} from "@app/core/community-forms"
import {
  COMMUNITY_REPORT_KIND,
  COMMUNITY_REPORT_REVIEW_LABEL_KIND,
  COMMUNITY_REPORT_REVIEW_NAMESPACE,
  makeCommunityEventReport,
  makeCommunityPersonReport,
  makeCommunityReportDelete,
  makeCommunityReportReviewLabel,
} from "@app/core/community-reports"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
}))

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
})

vi.mock("@app/core/repo-watch", () => ({
  repoWatchNotificationSeen: readable({}),
}))

vi.mock("@app/util/repo-watch-notifications", () => ({
  repoWatchNotificationCandidates: readable([]),
  repoWatchNotificationHistoryStatus: readable({
    loading: false,
    complete: true,
    saturated: false,
  }),
}))

vi.mock("@app/extensions/widget-update-notifications", () => ({
  installedWidgetUpdates: readable([]),
  getInstalledWidgetUpdateNotificationId: (update: {id: string; latest: {id: string}}) =>
    `widget-update:${update.id}:${update.latest.id}`,
}))

const makeEvent = (overrides: Partial<TrustedEvent> = {}) =>
  ({
    id: "event-a",
    kind: 4444,
    pubkey: "alice",
    created_at: 100,
    tags: [["p", "viewer"]],
    content: "ciphertext",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeChat = (event: TrustedEvent, overrides: Partial<Chat> = {}): Chat => ({
  id: event.pubkey,
  pubkeys: ["viewer", event.pubkey],
  messages: [event],
  latestMessage: event,
  latestIncomingMessage: event,
  last_activity: event.created_at,
  search_text: event.pubkey,
  ...overrides,
})

const viewer = getPublicKey(new Uint8Array(32).fill(1))
const writer = getPublicKey(new Uint8Array(32).fill(2))
const outsider = getPublicKey(new Uint8Array(32).fill(3))
const banned = getPublicKey(new Uint8Array(32).fill(4))
const muted = getPublicKey(new Uint8Array(32).fill(5))
const communityPubkey = getPublicKey(new Uint8Array(32).fill(6))
const profileListPubkey = getPublicKey(new Uint8Array(32).fill(8))
const zapper = getPublicKey(new Uint8Array(32).fill(9))
const reportCommunity = makeCommunityPointer({
  ownerPubkey: communityPubkey,
  communityId: zapper,
})!
const notificationCommunity = makeCommunityPointer({
  ownerPubkey: communityPubkey,
  communityId: zapper,
})!
const makeApplicationAuthorityTags = (tags: string[][] = []) =>
  makeCommunityAuthorityTags(notificationCommunity, undefined, tags)
const siblingCommunity = makeCommunityPointer({
  ownerPubkey: getPublicKey(new Uint8Array(32).fill(7)),
  communityId: zapper,
})!
const profileListAddress = `${PROFILE_LIST_KIND}:${profileListPubkey}:${notificationCommunity.communityId}-general`
const threadProfileListAddress = `${PROFILE_LIST_KIND}:${profileListPubkey}:${notificationCommunity.communityId}-threads`
const calendarProfileListAddress = `${PROFILE_LIST_KIND}:${profileListPubkey}:${notificationCommunity.communityId}-calendar`
const goalProfileListAddress = `${PROFILE_LIST_KIND}:${profileListPubkey}:${notificationCommunity.communityId}-goals`
const emptyReportState = {eventReports: [], personReports: []} as any

const makeCommunityRef = (): ActiveUserCommunityRef => ({
  community: notificationCommunity,
  relayHints: [],
  roles: ["member"],
  writableSections: [COMMUNITY_SECTION_GENERAL, COMMUNITY_SECTION_THREADS],
  definition: {
    event: makeEvent({
      id: "community",
      kind: 32222,
      pubkey: communityPubkey,
      content: "",
      tags: [["d", zapper]],
    }),
    pointer: notificationCommunity,
    communityId: notificationCommunity.communityId,
    ownerPubkey: notificationCommunity.ownerPubkey,
    metadata: {name: "Community"},
    relays: [],
    blossomServers: [],
    graspServers: [],
    mints: [],
    services: [],
    sourceTags: [],
    sections: [
      {
        name: COMMUNITY_SECTION_GENERAL,
        kinds: [{kind: MESSAGE, subtype: "room-message"}, {kind: COMMENT}, {kind: REACTION}],
        profileLists: [
          {
            address: profileListAddress,
          },
        ],
        badges: [],
        retention: [],
      },
      {
        name: COMMUNITY_SECTION_THREADS,
        kinds: [{kind: THREAD, subtype: "threads"}],
        profileLists: [
          {
            address: threadProfileListAddress,
          },
        ],
        badges: [],
        retention: [],
      },
      {
        name: COMMUNITY_SECTION_CALENDAR,
        kinds: [{kind: EVENT_TIME}],
        profileLists: [
          {
            address: calendarProfileListAddress,
          },
        ],
        badges: [],
        retention: [],
      },
      {
        name: COMMUNITY_SECTION_GOALS,
        kinds: [{kind: ZAP_GOAL}],
        profileLists: [
          {
            address: goalProfileListAddress,
          },
        ],
        badges: [],
        retention: [],
      },
    ],
  },
})

const makeTargetedCommunityRef = () => {
  return makeCommunityRef()
}

const makeProfileList = (address = profileListAddress) => {
  const [, pubkey, identifier] = address.split(":")

  return makeEvent({
    id: `profile-list-${identifier}`,
    kind: PROFILE_LIST_KIND,
    pubkey,
    tags: [
      ["d", identifier],
      ["a", address],
      ["p", writer],
      ["p", viewer],
    ],
  })
}

const makeTargetingEvent = ({
  id,
  kind,
  originalId,
  pubkey = communityPubkey,
}: {
  id: string
  kind: number
  originalId: string
  pubkey?: string
}) =>
  makeEvent({
    id,
    kind: TARGETED_PUBLICATION_KIND,
    pubkey,
    content: "",
    tags: buildTargetedPublication({
      id: `${id}-target`,
      kind,
      source: /^[0-9a-f]{64}$/.test(originalId) ? {type: "e", value: originalId} : undefined,
      communities: [notificationCommunity],
    }).tags,
  })

describe("notification sources", () => {
  it("builds unread chat rows from latest incoming DM events", async () => {
    const {buildChatNotificationRows, getLatestNotificationCenterTimestamp} =
      await import("./notification-sources")
    const event = makeEvent()
    const rows = buildChatNotificationRows({
      chats: [makeChat(event)],
      getPlaintext: () => "hello from alice",
    })

    expect(rows).toEqual([
      expect.objectContaining({
        id: "event:event-a",
        eventId: "event-a",
        actorPubkey: "alice",
        source: "chat",
        type: "chat",
        title: "Direct message",
        preview: "hello from alice",
        action: "messaged you",
        contextLabel: "Direct message",
        path: "/chat/alice",
        readPath: "/chat/alice",
        navigationEventId: "event-a",
        detail: expect.objectContaining({label: "Message", actionLabel: "Open chat"}),
        createdAt: 100,
      }),
    ])
    expect(getLatestNotificationCenterTimestamp(rows)).toBe(100)
  })

  it("builds route fallback rows with source labels and read paths", async () => {
    const {buildRouteNotificationRows} = await import("./notification-sources")

    const rows = buildRouteNotificationRows({
      paths: [
        "/chat",
        "/chat/alice",
        "/git/repo",
        "/c/community/rooms/root",
        "/c/community/git",
        "/settings",
        "/settings/git",
      ],
      excludedPaths: new Set(["/chat/alice"]),
    })

    expect(rows).toHaveLength(4)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source: "chat", path: "/chat", readPath: "/chat/*"}),
        expect.objectContaining({source: "git", path: "/git/repo"}),
        expect.objectContaining({source: "community", path: "/c/community/rooms/root"}),
        expect.objectContaining({source: "community", path: "/c/community/git"}),
      ]),
    )
    expect(rows.map(row => row.path)).not.toEqual(
      expect.arrayContaining(["/settings", "/settings/git"]),
    )
    expect(rows.find(row => row.path === "/git/repo")?.preview).toBe("Open git activity")
    expect(rows.find(row => row.path === "/git/repo")?.preview).not.toContain("/")
  })

  it("builds community route fallback rows with candidate event timestamps", async () => {
    const {buildRouteNotificationRows} = await import("./notification-sources")
    const {displayProfileByPubkey} = await import("@welshman/app")
    const mentionMessage = makeEvent({
      id: "mention-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 123,
      content: "hey #[0]",
      tags: [
        ["p", viewer],
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
      ],
    })
    const path = `/c/${communityPubkey}/rooms/room-one`

    expect(
      buildRouteNotificationRows({
        paths: [path],
        candidates: [{path, latestEvent: mentionMessage}],
        currentPubkey: viewer,
      }),
    ).toEqual([
      expect.objectContaining({
        source: "community",
        type: "mention",
        title: "New room mention",
        preview: `hey @${displayProfileByPubkey(viewer)}`,
        actorPubkey: writer,
        createdAt: 123,
        eventId: mentionMessage.id,
        detail: expect.objectContaining({event: mentionMessage}),
      }),
    ])
  })

  it("keeps a newer room fallback visible when an older specific row covers its path", async () => {
    const {buildRouteNotificationRows} = await import("./notification-sources")
    const roomMessage = makeEvent({
      id: "newer-room-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 200,
      content: "the message that lit the room badge",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
      ],
    })
    const path = `/c/${communityPubkey}/rooms/room-one`
    const options = {
      paths: [path],
      excludedPaths: new Set([path]),
      candidates: [{path, latestEvent: roomMessage}],
      currentPubkey: viewer,
    }

    expect(
      buildRouteNotificationRows({
        ...options,
        coveredAtByPath: new Map([[path, 100]]),
      }),
    ).toEqual([
      expect.objectContaining({
        eventId: roomMessage.id,
        actorPubkey: writer,
        type: "community",
        title: "New room message",
        preview: "the message that lit the room badge",
        createdAt: 200,
      }),
    ])
    expect(
      buildRouteNotificationRows({
        ...options,
        coveredAtByPath: new Map([[path, 200]]),
      }),
    ).toEqual([])
  })

  it("uses the newest route candidate for unread timestamps", async () => {
    const {buildRouteNotificationRows, getLatestNotificationCenterTimestamp} =
      await import("./notification-sources")
    const path = `/c/${communityPubkey}/access`
    const older = makeEvent({
      id: "older-access-event",
      kind: REACTION,
      pubkey: writer,
      created_at: 100,
      content: "+",
      tags: [["e", "older-request"]],
    })
    const newer = makeEvent({
      id: "newer-access-event",
      kind: REACTION,
      pubkey: writer,
      created_at: 200,
      content: "-",
      tags: [["e", "newer-request"]],
    })
    const rows = buildRouteNotificationRows({
      paths: [path],
      candidates: [newer, older].map(latestEvent => ({path, latestEvent})),
      currentPubkey: viewer,
    })

    expect(rows[0]).toEqual(expect.objectContaining({eventId: newer.id, createdAt: 200}))
    expect(getLatestNotificationCenterTimestamp(rows)).toBe(200)
  })

  it("treats a second event at the same community route as new after reading the first", async () => {
    const {buildRouteNotificationRows} = await import("./notification-sources")
    const {markNotificationRowsReadState, hasUnreadNotificationRowsState} =
      await import("./notification-center")
    const path = `/c/${communityPubkey}/access`
    const build = (id: string) =>
      buildRouteNotificationRows({
        paths: [path],
        currentPubkey: viewer,
        candidates: [
          {path, latestEvent: makeEvent({id, kind: REACTION, content: "+", pubkey: writer})},
        ],
      })[0]
    const first = build("first-decision")
    const second = build("second-decision")
    const read = markNotificationRowsReadState(undefined, viewer, [first.id])
    expect(hasUnreadNotificationRowsState(read, viewer, [first.id])).toBe(false)
    expect(hasUnreadNotificationRowsState(read, viewer, [second.id])).toBe(true)
  })

  it("retains workflow rows after the route is checked and suppresses self-authored candidates", async () => {
    const {buildRouteNotificationRows} = await import("./notification-sources")
    const path = `/c/${communityPubkey}/admin`
    const candidate = {
      path,
      retainInCenter: true,
      latestEvent: makeEvent({
        id: "request",
        pubkey: writer,
        kind: 30000,
        tags: [["role", "moderator-request"]],
      }),
    }
    expect(
      buildRouteNotificationRows({paths: [], currentPubkey: viewer, candidates: [candidate]}),
    ).toMatchObject([{id: `route:${path}:request`, title: "New moderator request"}])
    expect(
      buildRouteNotificationRows({paths: [], currentPubkey: writer, candidates: [candidate]}),
    ).toEqual([])
    expect(
      buildRouteNotificationRows({
        paths: [],
        currentPubkey: viewer,
        candidates: [{...candidate, retainInCenter: false}],
      }),
    ).toEqual([])
  })

  it("notifies valid badge recipients and suppresses foreign, forged, muted, and withdrawn awards", async () => {
    const {buildCommunityBadgeNotificationRows} = await import("./notification-sources")
    const {
      makeCommunityBadgeDefinitionEvent,
      makeCommunityBadgeAwardEvent,
      makeCommunityBadgeAwardDelete,
    } = await import("@app/core/community-badges")
    const ref = makeCommunityRef()
    const definition = makeEvent({
      id: "badge-definition",
      pubkey: communityPubkey,
      ...makeCommunityBadgeDefinitionEvent({
        community: notificationCommunity,
        identifier: "helper",
        name: "Community helper",
      }),
    })
    const address = `30009:${communityPubkey}:${definition.tags.find(tag => tag[0] === "d")![1]}`
    const award = makeEvent({
      id: "badge-award",
      pubkey: communityPubkey,
      ...makeCommunityBadgeAwardEvent({
        community: notificationCommunity,
        definitionAddress: address,
        recipientPubkey: viewer,
      }),
    })
    const options = {
      refs: [ref],
      currentPubkey: viewer,
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
      badgeDefinitionEvents: [definition],
      badgeAwardEvents: [award],
    }
    expect(buildCommunityBadgeNotificationRows(options)).toMatchObject([
      {
        id: "community-badge:badge-award",
        contextLabel: "Community helper",
        action: "awarded you a badge",
        path: expect.stringContaining("/badges"),
      },
    ])
    expect(buildCommunityBadgeNotificationRows({...options, currentPubkey: outsider})).toEqual([])
    expect(
      buildCommunityBadgeNotificationRows({
        ...options,
        badgeAwardEvents: [{...award, pubkey: outsider}],
      }),
    ).toEqual([])
    expect(
      buildCommunityBadgeNotificationRows({...options, mutedPubkeys: [communityPubkey]}),
    ).toEqual([])
    expect(buildCommunityBadgeNotificationRows({...options, reportStates: new Map()})).toEqual([])
    expect(
      buildCommunityBadgeNotificationRows({
        ...options,
        badgeAwardEvents: [
          makeEvent({
            ...award,
            ...makeCommunityBadgeAwardEvent({
              community: siblingCommunity,
              definitionAddress: address,
              recipientPubkey: viewer,
            }),
          }),
        ],
      }),
    ).toEqual([])
    const withdrawal = makeEvent({
      id: "withdrawal",
      pubkey: communityPubkey,
      ...makeCommunityBadgeAwardDelete({community: notificationCommunity, awardId: award.id}),
    })
    expect(
      buildCommunityBadgeNotificationRows({...options, badgeAwardDeleteEvents: [withdrawal]}),
    ).toEqual([])
    expect(
      buildCommunityBadgeNotificationRows({
        ...options,
        badgeAwardDeleteEvents: [{...withdrawal, pubkey: outsider}],
      }),
    ).toHaveLength(1)
  })

  it("builds explicit access decision route rows", async () => {
    const {buildRouteNotificationRows} = await import("./notification-sources")
    const accessPath = `/c/${communityPubkey}/access`
    const moderatorAccepted = makeEvent({
      id: "moderator-accepted",
      kind: REACTION,
      pubkey: communityPubkey,
      created_at: 200,
      content: "+",
      tags: [["e", "moderator-request"]],
    })
    const publishingDenied = makeEvent({
      id: "publishing-denied",
      kind: REACTION,
      pubkey: writer,
      created_at: 210,
      content: "-",
      tags: [
        ["e", "form-response"],
        ["k", String(FORM_RESPONSE_KIND)],
      ],
    })

    expect(
      buildRouteNotificationRows({
        paths: [accessPath],
        candidates: [{path: accessPath, latestEvent: moderatorAccepted}],
        currentPubkey: viewer,
      }),
    ).toEqual([
      expect.objectContaining({
        source: "community",
        title: "Moderator request accepted",
        action: "approved your request for",
        contextLabel: "moderator role",
        eventId: moderatorAccepted.id,
      }),
    ])
    expect(
      buildRouteNotificationRows({
        paths: [accessPath],
        candidates: [{path: accessPath, latestEvent: publishingDenied}],
        currentPubkey: viewer,
      })[0],
    ).toEqual(
      expect.objectContaining({
        title: "Publishing request denied",
        action: "denied your request for",
        eventId: publishingDenied.id,
      }),
    )
  })

  it("builds section-scoped application rows for grant moderators", async () => {
    const {buildCommunityApplicationNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const generalProfileListAddress = `${PROFILE_LIST_KIND}:${viewer}:${COMMUNITY_SECTION_GENERAL}`
    const threadProfileListAddress = `${PROFILE_LIST_KIND}:${outsider}:${COMMUNITY_SECTION_THREADS}`
    ref.definition.sections[0].profileLists = [
      {
        address: generalProfileListAddress,
      },
    ]
    ref.definition.sections[1].profileLists = [
      {
        address: threadProfileListAddress,
      },
    ]
    const generalFormAddress = `${FORM_TEMPLATE_KIND}:${viewer}:general-application`
    const threadFormAddress = `${FORM_TEMPLATE_KIND}:${outsider}:threads-application`
    const generalForm = makeEvent({
      id: "general-form",
      kind: FORM_TEMPLATE_KIND,
      pubkey: viewer,
      tags: [
        ["d", "general-application"],
        ...makeApplicationAuthorityTags([
          ["content", COMMUNITY_SECTION_GENERAL],
          ["name", "General application"],
        ]),
      ],
    })
    const threadForm = makeEvent({
      id: "thread-form",
      kind: FORM_TEMPLATE_KIND,
      pubkey: outsider,
      tags: [
        ["d", "threads-application"],
        ...makeApplicationAuthorityTags([
          ["content", COMMUNITY_SECTION_THREADS],
          ["name", "Threads application"],
        ]),
      ],
    })
    const generalResponse = makeEvent({
      id: "general-response",
      kind: FORM_RESPONSE_KIND,
      pubkey: writer,
      created_at: 140,
      tags: [
        ...makeApplicationAuthorityTags([
          ["a", generalFormAddress, "", "form"],
          ["response", "q1", "I would like to post updates."],
        ]),
      ],
    })
    const threadResponse = makeEvent({
      id: "thread-response",
      kind: FORM_RESPONSE_KIND,
      pubkey: writer,
      created_at: 150,
      tags: [
        ...makeApplicationAuthorityTags([
          ["a", threadFormAddress, "", "form"],
          ["response", "q1", "I would like to create threads."],
        ]),
      ],
    })

    const rows = buildCommunityApplicationNotificationRows({
      refs: [ref],
      currentPubkey: viewer,
      profileListEvents: [
        makeEvent({
          id: "general-profile-list",
          kind: PROFILE_LIST_KIND,
          pubkey: viewer,
          tags: [["d", COMMUNITY_SECTION_GENERAL]],
        }),
        makeEvent({
          id: "thread-profile-list",
          kind: PROFILE_LIST_KIND,
          pubkey: outsider,
          tags: [["d", COMMUNITY_SECTION_THREADS]],
        }),
      ],
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
      admissionFormEvents: [generalForm, threadForm],
      admissionResponseEvents: [generalResponse, threadResponse],
    })

    expect(rows.map(row => row.eventId)).toEqual([generalResponse.id])
    expect(rows[0]).toEqual(
      expect.objectContaining({
        source: "community",
        title: "New publishing request",
        action: "requested to publish in",
        actorPubkey: writer,
        path: expect.stringContaining("/moderation"),
        target: expect.objectContaining({label: "Application form", eventId: generalForm.id}),
      }),
    )
  })

  it("builds applicant rows for publishing access decisions", async () => {
    const {buildCommunityApplicationNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const formAddress = `${FORM_TEMPLATE_KIND}:${profileListPubkey}:general-application`
    const form = makeEvent({
      id: "general-form",
      kind: FORM_TEMPLATE_KIND,
      pubkey: profileListPubkey,
      tags: [
        ["d", "general-application"],
        ...makeApplicationAuthorityTags([
          ["content", COMMUNITY_SECTION_GENERAL],
          ["name", "General application"],
        ]),
      ],
    })
    const response = makeEvent({
      id: "general-response",
      kind: FORM_RESPONSE_KIND,
      pubkey: viewer,
      created_at: 200,
      tags: makeApplicationAuthorityTags([["a", formAddress, "", "form"]]),
    })
    const outsiderResponse = makeEvent({
      id: "outsider-response",
      kind: FORM_RESPONSE_KIND,
      pubkey: outsider,
      created_at: 205,
      tags: makeApplicationAuthorityTags([["a", formAddress, "", "form"]]),
    })
    const accepted = makeEvent({
      id: "general-accepted",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: profileListPubkey,
      created_at: 220,
      content: "+",
      tags: [
        ...makeApplicationAuthorityTags([
          ["e", response.id, "", "", "response"],
          ["p", viewer],
          ["k", String(FORM_RESPONSE_KIND)],
          ["a", formAddress, "", "form"],
          ["content", COMMUNITY_SECTION_GENERAL],
        ]),
      ],
    })
    const revoked = makeEvent({
      id: "general-revoked",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: profileListPubkey,
      created_at: 240,
      content: "-",
      tags: [
        ...makeApplicationAuthorityTags([
          ["e", response.id, "", "", "response"],
          ["p", viewer],
          ["k", String(FORM_RESPONSE_KIND)],
          ["a", formAddress, "", "form"],
          ["content", COMMUNITY_SECTION_GENERAL],
        ]),
      ],
    })
    const spoofedReview = makeEvent({
      ...accepted,
      id: "spoofed-review",
      pubkey: outsider,
      created_at: 250,
    })
    const wrongApplicantReview = makeEvent({
      ...accepted,
      id: "wrong-applicant-review",
      created_at: 260,
      tags: accepted.tags.map(tag =>
        tag[0] === "e" ? ["e", outsiderResponse.id, "", "", "response"] : [...tag],
      ),
    })

    const rows = buildCommunityApplicationNotificationRows({
      refs: [ref],
      currentPubkey: viewer,
      profileListEvents: [makeProfileList()],
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
      admissionFormEvents: [form],
      admissionResponseEvents: [response, outsiderResponse],
      admissionReviewEvents: [accepted, revoked, spoofedReview, wrongApplicantReview],
    })

    expect(rows).toEqual([
      expect.objectContaining({
        source: "community",
        title: "Publishing access revoked",
        action: "revoked your access to publish in",
        actorPubkey: profileListPubkey,
        path: expect.stringContaining("/access"),
        eventId: revoked.id,
      }),
      expect.objectContaining({
        source: "community",
        title: "Publishing request approved",
        action: "approved your request to publish in",
        actorPubkey: profileListPubkey,
        path: expect.stringContaining("/access"),
        eventId: accepted.id,
      }),
    ])
    expect(rows.map(row => row.eventId)).not.toEqual(
      expect.arrayContaining([spoofedReview.id, wrongApplicantReview.id]),
    )
    expect(
      buildCommunityApplicationNotificationRows({
        refs: [ref],
        currentPubkey: viewer,
        profileListEvents: [makeProfileList()],
        reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
        outcomeReportStates: new Map(),
        admissionFormEvents: [form],
        admissionResponseEvents: [response],
        admissionReviewEvents: [accepted],
      }),
    ).toEqual([])
  })

  it("validates first-time denied outcomes from exact references without an active ref", async () => {
    const {buildCommunityApplicationNotificationRows} = await import("./notification-sources")
    const definition = makeEvent({
      id: "outcome-community-definition",
      kind: 32222,
      pubkey: communityPubkey,
      content: "",
      tags: buildCommunityDefinition({
        communityId: notificationCommunity.communityId,
        name: "Community",
        relays: ["wss://community.example"],
        sections: [
          {
            name: COMMUNITY_SECTION_GENERAL,
            kinds: [{kind: COMMENT}],
            profileLists: [{address: profileListAddress}],
          },
        ],
      }).tags,
    })
    const formAddress = `${FORM_TEMPLATE_KIND}:${profileListPubkey}:first-application`
    const form = makeEvent({
      id: "first-application-form",
      kind: FORM_TEMPLATE_KIND,
      pubkey: profileListPubkey,
      tags: [
        ["d", "first-application"],
        ...makeApplicationAuthorityTags([["content", COMMUNITY_SECTION_GENERAL]]),
      ],
    })
    const response = makeEvent({
      id: "first-application-response",
      kind: FORM_RESPONSE_KIND,
      pubkey: viewer,
      tags: makeApplicationAuthorityTags([["a", formAddress, "", "form"]]),
    })
    const denied = makeEvent({
      id: "first-application-denied",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: profileListPubkey,
      content: "-",
      tags: [
        ...makeApplicationAuthorityTags([
          ["e", response.id, "", "", "response"],
          ["p", viewer],
          ["k", String(FORM_RESPONSE_KIND)],
          ["a", formAddress, "", "form"],
          ["content", COMMUNITY_SECTION_GENERAL],
        ]),
      ],
    })

    expect(
      buildCommunityApplicationNotificationRows({
        refs: [],
        outcomeDefinitionEvents: [definition],
        currentPubkey: viewer,
        profileListEvents: [makeProfileList()],
        reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
        admissionFormEvents: [form],
        admissionResponseEvents: [response],
        admissionReviewEvents: [denied],
      }),
    ).toEqual([
      expect.objectContaining({
        eventId: denied.id,
        title: "Publishing request denied",
        path: expect.stringContaining("/access"),
      }),
    ])
  })

  it("validates final revocation outcomes after membership refs disappear", async () => {
    const {buildCommunityApplicationNotificationRows} = await import("./notification-sources")
    const definition = makeEvent({
      id: "revoked-community-definition",
      kind: 32222,
      pubkey: communityPubkey,
      content: "",
      tags: buildCommunityDefinition({
        communityId: notificationCommunity.communityId,
        name: "Community",
        relays: ["wss://community.example"],
        sections: [
          {
            name: COMMUNITY_SECTION_GENERAL,
            kinds: [{kind: COMMENT}],
            profileLists: [{address: profileListAddress}],
          },
        ],
      }).tags,
    })
    const formAddress = `${FORM_TEMPLATE_KIND}:${profileListPubkey}:revoked-application`
    const form = makeEvent({
      id: "revoked-application-form",
      kind: FORM_TEMPLATE_KIND,
      pubkey: profileListPubkey,
      tags: [
        ["d", "revoked-application"],
        ...makeApplicationAuthorityTags([["content", COMMUNITY_SECTION_GENERAL]]),
      ],
    })
    const response = makeEvent({
      id: "revoked-application-response",
      kind: FORM_RESPONSE_KIND,
      pubkey: viewer,
      tags: makeApplicationAuthorityTags([["a", formAddress, "", "form"]]),
    })
    const makeReview = (id: string, content: "+" | "-", created_at: number) =>
      makeEvent({
        id,
        kind: COMMUNITY_FORM_REVIEW_KIND,
        pubkey: profileListPubkey,
        created_at,
        content,
        tags: [
          ...makeApplicationAuthorityTags([
            ["e", response.id, "", "", "response"],
            ["p", viewer],
            ["k", String(FORM_RESPONSE_KIND)],
            ["a", formAddress, "", "form"],
            ["content", COMMUNITY_SECTION_GENERAL],
          ]),
        ],
      })
    const granted = makeReview("no-ref-granted", "+", 200)
    const revoked = makeReview("no-ref-revoked", "-", 300)

    const rows = buildCommunityApplicationNotificationRows({
      refs: [],
      outcomeDefinitionEvents: [definition],
      currentPubkey: viewer,
      profileListEvents: [makeProfileList()],
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
      admissionFormEvents: [form],
      admissionResponseEvents: [response],
      admissionReviewEvents: [granted, revoked],
    })
    expect(rows.find(row => row.eventId === revoked.id)).toEqual(
      expect.objectContaining({title: "Publishing access revoked"}),
    )
  })

  it("filters notification rows by selected sources and profile names", async () => {
    const {filterNotificationRows, NOTIFICATION_ROW_FILTERS} =
      await import("./notification-display")
    const rows = [
      {
        id: "event:chat",
        eventId: "chat",
        source: "chat",
        sourceLabel: "DMs",
        title: "Direct message",
        preview: "hello alice",
        path: "/chat/alice",
        readPath: "/chat/alice",
        createdAt: 100,
        searchText: "chat alice hello",
      },
      {
        id: "event:community",
        eventId: "community",
        source: "community",
        sourceLabel: "Communities",
        title: "New room reply",
        preview: "reply from a community member",
        path: "/c/community/rooms/root",
        readPath: "/c/community/rooms/root",
        createdAt: 50,
        actorName: "Ada Lovelace",
        searchText: "community reply",
      },
      {
        id: "route:/git/repo",
        source: "git",
        sourceLabel: "Git",
        title: "Unread git activity",
        preview: "repo issue",
        path: "/git/repo",
        readPath: "/git/repo",
        createdAt: 0,
        searchText: "git repo ada issue",
      },
    ] as const
    const filterValues = NOTIFICATION_ROW_FILTERS.map(option => option.value)

    expect(filterValues).toEqual(["community", "git", "chat", "widget"])
    expect(filterValues).not.toEqual(expect.arrayContaining(["all", "read", "social", "unread"]))
    expect(filterValues.join(" ")).not.toMatch(new RegExp(["re", "post"].join(""), "i"))
    expect(filterNotificationRows([...rows], {filters: ["git"]}).map(row => row.id)).toEqual([
      "route:/git/repo",
    ])
    expect(
      filterNotificationRows([...rows], {filters: ["git", "community"]}).map(row => row.id),
    ).toEqual(["event:community", "route:/git/repo"])
    expect(filterNotificationRows([...rows], {term: "alice"}).map(row => row.id)).toEqual([
      "event:chat",
    ])
    expect(filterNotificationRows([...rows], {term: "lovelace"}).map(row => row.id)).toEqual([
      "event:community",
    ])
    expect(filterNotificationRows([...rows], {term: "ada"}).map(row => row.id)[0]).toBe(
      "event:community",
    )
  })

  it("builds community notification filters even before profile-list authors are hydrated", async () => {
    const {buildGlobalCommunityNotificationFilters} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const filters = buildGlobalCommunityNotificationFilters({
      refs: [ref],
      profileListEvents: [],
      currentPubkey: viewer,
      since: 10,
      limit: 50,
    })

    expect(filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kinds: [MESSAGE],
          "#h": [notificationCommunity.communityId],
          since: 10,
        }),
        expect.objectContaining({
          kinds: [COMMENT],
          "#h": [notificationCommunity.communityId],
          since: 10,
        }),
        expect.objectContaining({
          kinds: [MESSAGE],
          "#h": [notificationCommunity.communityId],
          "#p": [viewer],
          since: 10,
        }),
        expect.objectContaining({
          kinds: [COMMENT],
          "#h": [notificationCommunity.communityId],
          "#p": [viewer],
          since: 10,
        }),
      ]),
    )
  })

  it("keeps more than 1,000 community writers out of relay filters", async () => {
    const {buildGlobalCommunityNotificationFilterPlan} = await import("./notification-sources")
    const writers = Array.from({length: 1_001}, (_, index) => {
      const secret = new Uint8Array(32)
      new DataView(secret.buffer).setUint32(28, index + 10)
      return getPublicKey(secret)
    })
    const profileList = makeEvent({
      id: "large-profile-list",
      kind: PROFILE_LIST_KIND,
      pubkey: profileListPubkey,
      tags: [
        ["d", `${notificationCommunity.communityId}-general`],
        ...writers.map(pubkey => ["p", pubkey]),
      ],
    })
    const plan = buildGlobalCommunityNotificationFilterPlan({
      refs: [makeCommunityRef()],
      profileListEvents: [profileList],
      currentPubkey: viewer,
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
      since: 10,
      limit: 50,
    })

    expect(plan.relayFilters).not.toHaveLength(0)
    expect(plan.relayFilters.every(filter => filter.authors === undefined)).toBe(true)
    expect(
      Math.max(...plan.localFilters.map(filter => filter.authors?.length || 0)),
    ).toBeGreaterThan(1_000)
  })

  it("admits referenced member writers without requiring moderator responses", async () => {
    const {buildCommunityNotificationRows, buildGlobalCommunityNotificationFilterPlan} =
      await import("./notification-sources")
    const ref = makeCommunityRef()
    const mention = makeEvent({
      id: "incomplete-evidence-mention",
      kind: MESSAGE,
      pubkey: writer,
      content: "hi #[0]",
      tags: [
        ["p", viewer],
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
      ],
    })
    const makePlan = (profileListEvents: TrustedEvent[], reportState: any) =>
      buildGlobalCommunityNotificationFilterPlan({
        refs: [ref],
        profileListEvents,
        currentPubkey: viewer,
        reportStates: new Map([[notificationCommunity.address, reportState]]),
        since: 10,
        limit: 50,
      })

    expect(makePlan([], emptyReportState).relayFilters).not.toHaveLength(0)
    expect(makePlan([], emptyReportState).localFilters).not.toHaveLength(0)
    expect(makePlan([makeProfileList()], undefined).localFilters).toEqual([])
    expect(makePlan([makeProfileList()], emptyReportState).localFilters).not.toHaveLength(0)
    expect(
      buildCommunityNotificationRows({
        refs: [ref],
        events: [mention],
        profileListEvents: [makeProfileList()],
        currentPubkey: viewer,
        reportStates: new Map([[notificationCommunity.address, undefined]]),
      }),
    ).toEqual([])
  })

  it("aggregates incomplete catch-up status and clears stale sources", async () => {
    const {
      areNotificationAuthorityLoadsComplete,
      buildNotificationCommunitySeedRefs,
      createNotificationHistoryStatusController,
      isNotificationHistoryIncomplete,
    } = await import("./notification-sources")
    const status = createNotificationHistoryStatusController()
    const first = {}
    const second = {}

    expect(get(status.incomplete)).toBe(false)
    status.start(first, 2)
    expect(get(status.incomplete)).toBe(true)
    status.resolve(first, {complete: true})
    expect(get(status.incomplete)).toBe(true)
    status.resolve(first, {complete: false})
    expect(get(status.incomplete)).toBe(true)
    status.start(second, 1)
    status.clear(first)
    status.resolve(second, {complete: true})
    expect(get(status.incomplete)).toBe(false)
    status.clear(second)
    expect(get(status.incomplete)).toBe(false)

    expect(areNotificationAuthorityLoadsComplete([{complete: true}, {complete: true}])).toBe(true)
    expect(areNotificationAuthorityLoadsComplete([{complete: true}, {complete: false}])).toBe(false)
    expect(
      isNotificationHistoryIncomplete(false, {
        loading: false,
        complete: true,
        saturated: false,
      }),
    ).toBe(false)
    expect(
      isNotificationHistoryIncomplete(false, {
        loading: false,
        complete: false,
        saturated: false,
      }),
    ).toBe(true)
    expect(
      buildNotificationCommunitySeedRefs({
        refs: [makeCommunityRef()],
        definitionEvents: [],
        renouncedCommunityAddresses: [notificationCommunity.address],
      }),
    ).toEqual([])
  })

  it("selects only the active exact community branch for notifications", async () => {
    const {selectActiveNotificationCommunityRefs} = await import("./notification-sources")
    const activeRef = makeCommunityRef()
    const siblingRef: ActiveUserCommunityRef = {
      ...makeCommunityRef(),
      community: siblingCommunity,
    }

    expect(
      selectActiveNotificationCommunityRefs([activeRef, siblingRef], notificationCommunity).map(
        ref => ref.community.address,
      ),
    ).toEqual([notificationCommunity.address])
    expect(selectActiveNotificationCommunityRefs([activeRef, siblingRef], undefined)).toEqual([])
  })

  it("paginates broad notification history past outsider-only raw pages", async () => {
    const {createBoundedNotificationHistoryLoader} = await import("./notification-sources")
    const relay = "wss://notifications.example/"
    const outsiderEvents = [
      makeEvent({
        id: "outsider-new",
        kind: COMMENT,
        pubkey: outsider,
        created_at: 30,
        tags: [["h", notificationCommunity.communityId]],
      }),
      makeEvent({
        id: "outsider-old",
        kind: COMMENT,
        pubkey: outsider,
        created_at: 20,
        tags: [["h", notificationCommunity.communityId]],
      }),
    ]
    const authorized = makeEvent({
      id: "authorized-older",
      kind: COMMENT,
      pubkey: writer,
      created_at: 10,
      tags: [["h", notificationCommunity.communityId]],
    })
    const requestHistory = vi.fn(async (options: any) => {
      const events = options.filters[0].until === undefined ? outsiderEvents : [authorized]
      for (const event of events) options.onEvent?.(event, relay)
      options.onEose?.()
      return events
    })
    const admitted: TrustedEvent[] = []
    const load = createBoundedNotificationHistoryLoader({
      request: requestHistory,
      onEvent: event => admitted.push(event),
    })
    const result = await load({
      relays: [relay],
      relayFilters: [{kinds: [COMMENT], "#h": [notificationCommunity.communityId]}],
      localFilters: [{kinds: [COMMENT], authors: [writer]}],
      pageSize: 2,
      maxPages: 3,
    })

    expect(requestHistory).toHaveBeenCalledTimes(2)
    expect(requestHistory.mock.calls[0][0].filters[0]).not.toHaveProperty("authors")
    expect(admitted.map(event => event.id)).toEqual([authorized.id])
    expect(result.events.map(event => event.id)).toEqual([authorized.id])
  })

  it("partitions community filters by relay and suppresses only foreground live coverage", async () => {
    const {groupCommunityNotificationFiltersByRelay} = await import("./notification-sources")
    const firstCommunityId = "3".repeat(64)
    const secondCommunityId = "4".repeat(64)
    const firstCommunityAddress = `32222:${"5".repeat(64)}:${firstCommunityId}`
    const secondCommunityAddress = `32222:${"6".repeat(64)}:${secondCommunityId}`
    const firstFilter = {kinds: [MESSAGE], "#h": [firstCommunityId]}
    const secondFilter = {kinds: [COMMENT], "#h": [secondCommunityId]}
    const sharedRelay = "wss://shared.example/"
    const ownership = new Set([`${firstCommunityAddress}\n${sharedRelay}`])

    const groups = groupCommunityNotificationFiltersByRelay(
      [
        {
          communityAddress: firstCommunityAddress,
          relays: ["wss://first.example", sharedRelay],
          filters: [firstFilter],
        },
        {
          communityAddress: secondCommunityAddress,
          relays: ["wss://second.example", sharedRelay],
          filters: [secondFilter],
        },
      ],
      ownership,
    )

    expect(groups).toEqual([
      {
        relay: "wss://first.example/",
        filters: [firstFilter],
        localFilters: [firstFilter],
        liveFilters: [firstFilter],
      },
      {
        relay: "wss://second.example/",
        filters: [secondFilter],
        localFilters: [secondFilter],
        liveFilters: [secondFilter],
      },
      {
        relay: sharedRelay,
        filters: [firstFilter, secondFilter],
        localFilters: [firstFilter, secondFilter],
        liveFilters: [secondFilter],
      },
    ])

    expect(
      groupCommunityNotificationFiltersByRelay(
        [
          {
            communityAddress: firstCommunityAddress,
            relays: [sharedRelay],
            filters: [firstFilter],
          },
        ],
        new Set(),
      )[0].liveFilters,
    ).toEqual([firstFilter])
    expect(
      groupCommunityNotificationFiltersByRelay(
        [
          {communityAddress: firstCommunityAddress, relays: [sharedRelay], filters: [firstFilter]},
          {
            communityAddress: secondCommunityAddress,
            relays: [sharedRelay],
            filters: [secondFilter],
          },
        ],
        new Set(),
        true,
      ).map(group => ({scope: group.scope, filters: group.filters})),
    ).toEqual([
      {scope: firstCommunityAddress, filters: [firstFilter]},
      {scope: secondCommunityAddress, filters: [secondFilter]},
    ])
    expect(
      groupCommunityNotificationFiltersByRelay(
        [{communityAddress: firstCommunityAddress, relays: [], filters: [firstFilter]}],
        new Set(),
        true,
      ),
    ).toEqual([
      {
        relay: "",
        scope: firstCommunityAddress,
        filters: [firstFilter],
        localFilters: [firstFilter],
        liveFilters: [],
      },
    ])
  })

  it("suppresses generic community activity and delegates membership notices to grant transitions", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const allowedMessage = makeEvent({
      id: "allowed-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 50,
      content: "hello community",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
      ],
    })
    const outsiderMessage = makeEvent({
      id: "outsider-message",
      kind: MESSAGE,
      pubkey: outsider,
      created_at: 60,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-two"],
      ],
    })
    const bannedMessage = makeEvent({
      id: "banned-message",
      kind: MESSAGE,
      pubkey: banned,
      created_at: 70,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-three"],
      ],
    })
    const mutedMessage = makeEvent({
      id: "muted-message",
      kind: MESSAGE,
      pubkey: muted,
      created_at: 80,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-four"],
      ],
    })
    const censoredMessage = makeEvent({
      id: "censored-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 90,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-five"],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [allowedMessage, outsiderMessage, bannedMessage, mutedMessage, censoredMessage],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
      reportStates: new Map([
        [
          notificationCommunity.address,
          {
            personReports: [{targetPubkey: banned}],
            eventReports: [
              {
                targetEventId: censoredMessage.id,
                sectionName: COMMUNITY_SECTION_GENERAL,
              },
            ],
          } as any,
        ],
      ]),
      mutedPubkeys: [muted],
    })

    expect(rows).toEqual([])
    expect(rows.map(row => row.eventId)).not.toEqual(
      expect.arrayContaining([
        "allowed-message",
        "outsider-message",
        "banned-message",
        "muted-message",
        "censored-message",
      ]),
    )
    expect(rows.find(row => row.eventId === allowedMessage.id)).toBeUndefined()
    // List edits are handled by persisted grant transitions, not emitted as generic activity.
    expect(
      rows.find(row => row.eventId === `profile-list-${notificationCommunity.communityId}-general`),
    ).toBeUndefined()
  })

  it("builds community moderation rows affecting the signed-in user", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const banReport = makeEvent({
      id: "ban-report",
      kind: 1984,
      pubkey: writer,
      created_at: 100,
      content: "banned for spam",
    })
    const eventReport = makeEvent({
      id: "event-report",
      kind: 1984,
      pubkey: writer,
      created_at: 110,
      content: "removed post",
    })
    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [],
      currentPubkey: viewer,
      reportStates: new Map([
        [
          notificationCommunity.address,
          {
            personReports: [
              {
                event: banReport,
                target: "person",
                targetPubkey: viewer,
                reporterPubkey: writer,
                adminAuthored: true,
              },
            ],
            eventReports: [
              {
                event: eventReport,
                target: "event",
                targetPubkey: viewer,
                targetEventId: "moderated-event",
                targetEventKind: COMMENT,
                targetEventTitle: "Moderated comment",
                sectionName: COMMUNITY_SECTION_GENERAL,
                reporterPubkey: writer,
                adminAuthored: true,
              },
            ],
          } as any,
        ],
      ]),
    })

    expect(rows.find(row => row.eventId === banReport.id)).toEqual(
      expect.objectContaining({
        source: "community",
        title: "Community ban",
        action: "moderated you",
        contextLabel: "Community moderation",
        path: expect.stringContaining("/access"),
      }),
    )
    expect(rows.find(row => row.eventId === eventReport.id)).toEqual(
      expect.objectContaining({
        source: "community",
        title: "Content moderated",
        action: "moderated your content",
        contextLabel: "Community moderation",
        preview: "Moderated comment",
      }),
    )
  })

  it("builds content report rows for reported authors and section moderators", async () => {
    const {buildCommunityModerationNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    ref.definition.sections[0].kinds.push({kind: COMMUNITY_REPORT_KIND})
    const report = makeEvent({
      id: "content-report",
      pubkey: writer,
      created_at: 150,
      ...makeCommunityEventReport({
        community: reportCommunity,
        sectionName: COMMUNITY_SECTION_GENERAL,
        eventId: "reported-event",
        eventPubkey: viewer,
        eventKind: COMMENT,
        eventContent: "Reported comment",
      }),
    })

    expect(
      buildCommunityModerationNotificationRows({
        refs: [ref],
        currentPubkey: viewer,
        profileListEvents: [makeProfileList()],
        reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
        reportEvents: [report],
      }),
    ).toEqual([
      expect.objectContaining({
        title: "Content reported",
        action: "reported your content",
        actorPubkey: writer,
        path: expect.stringContaining("/moderation"),
      }),
    ])
    expect(
      buildCommunityModerationNotificationRows({
        refs: [ref],
        currentPubkey: profileListPubkey,
        profileListEvents: [makeProfileList()],
        reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
        reportEvents: [report],
      }),
    ).toEqual([
      expect.objectContaining({
        title: "New content report",
        action: "reported content",
        actorPubkey: writer,
        path: expect.stringContaining("/moderation"),
      }),
    ])
  })

  it("notifies reporters and other moderators when reported content is censored", async () => {
    const {buildCommunityModerationNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    ref.definition.sections[0].kinds.push({kind: COMMUNITY_REPORT_KIND})
    const contentReport = makeEvent({
      id: "prior-content-report",
      pubkey: writer,
      created_at: 120,
      ...makeCommunityEventReport({
        community: reportCommunity,
        sectionName: COMMUNITY_SECTION_GENERAL,
        eventId: "reported-event",
        eventPubkey: viewer,
        eventKind: COMMENT,
        eventContent: "Reported comment",
      }),
    })
    const censor = makeEvent({
      id: "censor-report",
      pubkey: profileListPubkey,
      created_at: 160,
      ...makeCommunityEventReport({
        community: reportCommunity,
        sectionName: COMMUNITY_SECTION_GENERAL,
        eventId: "reported-event",
        eventPubkey: viewer,
        eventKind: COMMENT,
        eventContent: "Reported comment",
      }),
    })
    const reportState = {
      personReports: [],
      eventReports: [
        {
          event: censor,
          target: "event",
          targetPubkey: viewer,
          targetEventId: "reported-event",
          targetEventKind: COMMENT,
          targetEventContent: "Reported comment",
          sectionName: COMMUNITY_SECTION_GENERAL,
          reporterPubkey: profileListPubkey,
          adminAuthored: false,
        },
      ],
    } as any

    expect(
      buildCommunityModerationNotificationRows({
        refs: [ref],
        currentPubkey: writer,
        profileListEvents: [makeProfileList()],
        reportEvents: [contentReport, censor],
        reportStates: new Map([[notificationCommunity.address, reportState]]),
      }).map(row => row.title),
    ).toEqual(["Reported content moderated"])
    expect(
      buildCommunityModerationNotificationRows({
        refs: [ref],
        currentPubkey: communityPubkey,
        profileListEvents: [makeProfileList()],
        reportEvents: [contentReport, censor],
        reportStates: new Map([[notificationCommunity.address, reportState]]),
      }).map(row => row.title),
    ).toEqual(["Content moderated", "New content report"])
  })

  it("notifies reporters when reports are reviewed and suppresses deleted reports", async () => {
    const {buildCommunityModerationNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    ref.definition.sections[0].kinds.push({kind: COMMUNITY_REPORT_KIND})
    const report = makeEvent({
      id: "reviewed-report",
      pubkey: writer,
      created_at: 120,
      ...makeCommunityEventReport({
        community: reportCommunity,
        sectionName: COMMUNITY_SECTION_GENERAL,
        eventId: "reported-event",
        eventPubkey: viewer,
        eventKind: COMMENT,
      }),
    })
    const review = makeEvent({
      id: "report-review",
      pubkey: profileListPubkey,
      created_at: 160,
      ...makeCommunityReportReviewLabel({
        community: reportCommunity,
        reportId: report.id,
        reporterPubkey: writer,
        targetEventId: "reported-event",
        targetEventKind: COMMENT,
        sectionName: COMMUNITY_SECTION_GENERAL,
      }),
    })
    const deletion = makeEvent({
      id: "report-delete",
      pubkey: writer,
      created_at: 170,
      ...makeCommunityReportDelete({
        community: reportCommunity,
        reportId: report.id,
        reporterPubkey: writer,
      }),
    })

    expect(
      buildCommunityModerationNotificationRows({
        refs: [ref],
        currentPubkey: writer,
        profileListEvents: [makeProfileList()],
        reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
        reportEvents: [report],
        reportReviewEvents: [review],
      }),
    ).toEqual([
      expect.objectContaining({
        title: "Report reviewed",
        action: "reviewed your report",
        actorPubkey: profileListPubkey,
      }),
    ])
    expect(
      buildCommunityModerationNotificationRows({
        refs: [ref],
        currentPubkey: profileListPubkey,
        profileListEvents: [makeProfileList()],
        reportEvents: [report],
        reportDeleteEvents: [deletion],
      }),
    ).toEqual([])
  })

  it("notifies active community members when a person is banned", async () => {
    const {buildCommunityModerationNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const banReport = makeEvent({
      id: "member-ban-report",
      pubkey: communityPubkey,
      created_at: 180,
      ...makeCommunityPersonReport({
        community: reportCommunity,
        pubkey: banned,
        content: "banned for spam",
      }),
    })

    expect(
      buildCommunityModerationNotificationRows({
        refs: [ref],
        currentPubkey: viewer,
        reportStates: new Map([
          [
            notificationCommunity.address,
            {
              eventReports: [],
              personReports: [
                {
                  event: banReport,
                  target: "person",
                  targetPubkey: banned,
                  reporterPubkey: communityPubkey,
                  adminAuthored: true,
                },
              ],
            } as any,
          ],
        ]),
      }),
    ).toEqual([
      expect.objectContaining({
        title: "Member banned",
        action: "banned a member",
        actorPubkey: communityPubkey,
        path: expect.stringContaining("/access"),
      }),
    ])
    expect(
      buildCommunityModerationNotificationRows({
        refs: [ref],
        currentPubkey: viewer,
        reportStates: new Map([
          [
            notificationCommunity.address,
            {
              eventReports: [],
              personReports: [
                {
                  event: banReport,
                  target: "person",
                  targetPubkey: viewer,
                  reporterPubkey: communityPubkey,
                  adminAuthored: true,
                },
              ],
            } as any,
          ],
        ]),
      }),
    ).toEqual([
      expect.objectContaining({
        title: "Community ban",
        action: "banned you",
        path: expect.stringContaining("/access"),
      }),
    ])
  })

  it("builds repo-watch rows with readable labels and seen paths", async () => {
    const {buildRepoWatchNotificationRows} = await import("./notification-sources")
    const {getNotificationRowDisplay} = await import("./notification-display")
    const issue = makeEvent({
      id: "issue-id",
      kind: GIT_ISSUE,
      pubkey: writer,
      created_at: 100,
      content: "Broken thing",
    })
    const comment = makeEvent({
      id: "comment-id",
      kind: GIT_COMMENT,
      pubkey: writer,
      created_at: 200,
      content: "I can reproduce this",
      tags: [
        ["E", issue.id],
        ["K", String(GIT_ISSUE)],
      ],
    })
    const status = makeEvent({
      id: "status-id",
      kind: GIT_STATUS_CLOSED,
      pubkey: writer,
      created_at: 300,
      tags: [
        ["e", "non-root-id"],
        ["e", issue.id, "", "root"],
      ],
    })
    const path = "/git/repo/issues"

    expect(
      buildRepoWatchNotificationRows({
        candidates: [{path, latestEvent: issue}],
      })[0],
    ).toEqual(
      expect.objectContaining({
        source: "git",
        type: "repo",
        title: "New issue",
        preview: "Broken thing",
        action: "opened an issue",
        contextLabel: "Issue",
        path: `${path}/${issue.id}`,
        readPath: path,
        repoWatchSeenPath: path,
        target: expect.objectContaining({label: "Issue", eventId: issue.id}),
      }),
    )

    const commentRow = buildRepoWatchNotificationRows({
      candidates: [{path, latestEvent: comment}],
    })[0]!

    expect(commentRow).toEqual(
      expect.objectContaining({
        title: "New git comment",
        path: `${path}/${issue.id}#comment-${comment.id}`,
      }),
    )
    expect(getNotificationRowDisplay(commentRow).sections).toHaveLength(1)

    expect(
      buildRepoWatchNotificationRows({
        candidates: [{path, latestEvent: status}],
      })[0]?.path,
    ).toBe(`${path}/${issue.id}`)
  })

  it("adds repo and trigger relays only to eligible repo notification navigation", async () => {
    const {addRepoNotificationRelayHints, buildRepoWatchNotificationRows} =
      await import("./notification-sources")
    const {receiveNotificationEvent} = await import("./notification-events")
    const repoNaddr = nip19.naddrEncode({
      kind: GIT_REPO_ANNOUNCEMENT,
      pubkey: viewer,
      identifier: "repo",
    })
    const basePath = `/git/${repoNaddr}/issues`
    const issue = makeEvent({
      id: "scoped-issue",
      kind: GIT_ISSUE,
      pubkey: writer,
      created_at: Math.floor(Date.now() / 1000),
    })
    const relays = ["wss://repo.example", "wss://second.example"]
    receiveNotificationEvent(issue, "wss://trigger.example")
    const row = buildRepoWatchNotificationRows({
      candidates: [{path: basePath, latestEvent: issue, repoRelayHints: relays}],
    })[0]!
    const encoded = row.path.split("/")[2]
    const decoded = nip19.decode(encoded)

    expect(decoded.type).toBe("naddr")
    expect(decoded.type === "naddr" ? decoded.data.relays : []).toEqual([
      "wss://repo.example/",
      "wss://second.example/",
      "wss://trigger.example/",
    ])
    expect(row.readPath).toBe(basePath)
    expect(row.repoWatchSeenPath).toBe(basePath)

    const report = makeEvent({kind: COMMUNITY_REPORT_KIND})
    const channelMessage = makeEvent({kind: 42})
    const reportReview = makeEvent({
      kind: COMMUNITY_REPORT_REVIEW_LABEL_KIND,
      tags: [["L", COMMUNITY_REPORT_REVIEW_NAMESPACE]],
    })
    expect(addRepoNotificationRelayHints(basePath, report, relays)).toBe(basePath)
    expect(addRepoNotificationRelayHints(basePath, channelMessage, relays)).toBe(basePath)
    expect(addRepoNotificationRelayHints(basePath, reportReview, relays)).toBe(basePath)
  })

  it("builds widget update rows that open extension settings", async () => {
    const {buildWidgetUpdateNotificationRows} = await import("./notification-sources")
    const widget = {
      id: "weather-1",
      kind: 30033,
      content: "Weather",
      pubkey: writer,
      created_at: 100,
      tags: [["d", "weather"]],
      identifier: "weather",
      widgetType: "tool",
      buttons: [],
      appUrl: "https://example.com/v1.html",
      version: "1.0.0",
    } as any
    const latest = {
      ...widget,
      id: "weather-2",
      created_at: 200,
      appUrl: "https://example.com/current.html",
      version: "1.1.0",
      changelog: "Better forecast data.",
    }

    expect(
      buildWidgetUpdateNotificationRows({
        updates: [
          {
            id: "30033:weather:weather",
            installed: widget,
            latest,
            relays: ["wss://widgets.example/"],
            diff: {
              version: {from: "1.0.0", to: "1.1.0"},
              changelog: "Better forecast data.",
              appUrlChanged: true,
              permissionsAdded: [],
              permissionsRemoved: [],
              slotChanged: false,
              widgetTypeChanged: false,
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "widget-update:30033:weather:weather:weather-2",
        source: "widget",
        sourceLabel: "Widgets",
        type: "widget",
        title: "Widget update available",
        action: "published an update for",
        actionLabel: "Review widget update",
        contextLabel: "Weather",
        path: "/settings/extensions",
        readPath: "/settings/extensions",
        createdAt: 200,
        preview: expect.stringContaining("Weather v1.1.0 is available."),
      }),
    ])
  })

  it("labels community room replies to the signed-in user's message", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const parentMessage = makeEvent({
      id: "parent-message",
      kind: MESSAGE,
      pubkey: viewer,
      created_at: 90,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
      ],
    })
    const quoted = `nostr:${nip19.neventEncode({id: "9".repeat(64)})}`
    const replyMessage = makeEvent({
      id: "reply-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 100,
      content: `${quoted}\n\nreply in room`,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
        ["q", parentMessage.id, "", viewer],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [replyMessage],
      targetEvents: [parentMessage],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
    })

    expect(rows.find(row => row.eventId === replyMessage.id)).toEqual(
      expect.objectContaining({
        source: "community",
        type: "reply",
        title: "New room reply",
        preview: "reply in room",
        actorPubkey: writer,
        path: expect.stringContaining("/rooms/room-one"),
        target: expect.objectContaining({label: "Context", eventId: parentMessage.id}),
        detail: expect.objectContaining({label: "New room reply", eventId: replyMessage.id}),
      }),
    )
  })

  it("rejects room replies whose exact parent no longer has a current grant", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const parentMessage = makeEvent({
      id: "revoked-parent-message",
      kind: MESSAGE,
      pubkey: viewer,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
      ],
    })
    const replyMessage = makeEvent({
      id: "reply-to-revoked-parent",
      kind: MESSAGE,
      pubkey: writer,
      content: "reply",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
        ["q", parentMessage.id, "", viewer],
      ],
    })
    const writerOnlyProfileList = makeEvent({
      id: "writer-only-profile-list",
      kind: PROFILE_LIST_KIND,
      pubkey: profileListPubkey,
      tags: [
        ["d", COMMUNITY_SECTION_GENERAL],
        ["p", writer],
      ],
    })

    expect(
      buildCommunityNotificationRows({
        refs: [makeCommunityRef()],
        events: [replyMessage],
        targetEvents: [parentMessage],
        profileListEvents: [writerOnlyProfileList],
        currentPubkey: viewer,
        reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
      }).find(row => row.eventId === replyMessage.id),
    ).toBeUndefined()
  })

  it("rejects community room replies when the claimed parent is unavailable", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const replyMessage = makeEvent({
      id: "reply-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 100,
      content: "reply in room",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
        ["q", "missing-parent", "", viewer],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [replyMessage],
      targetEvents: [],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
    })

    expect(rows.find(row => row.eventId === replyMessage.id)).toBeUndefined()
  })

  it("labels community room mentions to the signed-in user", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const {displayProfileByPubkey} = await import("@welshman/app")
    const ref = makeCommunityRef()
    const mentionMessage = makeEvent({
      id: "mention-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 100,
      content: "hey #[0] please check this",
      tags: [
        ["p", viewer],
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [mentionMessage],
      targetEvents: [],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
    })

    expect(rows.find(row => row.eventId === mentionMessage.id)).toEqual(
      expect.objectContaining({
        source: "community",
        type: "mention",
        title: "New room mention",
        preview: `hey @${displayProfileByPubkey(viewer)} please check this`,
        action: "mentioned you",
        actorPubkey: writer,
        path: expect.stringContaining("/rooms/room-one"),
        detail: expect.objectContaining({label: "New room mention", eventId: mentionMessage.id}),
      }),
    )
  })

  it("renders direct profile entities in compact notification previews", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const {displayProfileByPubkey} = await import("@welshman/app")
    const ref = makeCommunityRef()
    const profileEntity = nip19.nprofileEncode({pubkey: viewer})
    const mentionMessage = makeEvent({
      id: "mention-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 100,
      content: `nostr:${profileEntity} test`,
      tags: [
        ["p", viewer],
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [mentionMessage],
      targetEvents: [],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
    })
    const row = rows.find(row => row.eventId === mentionMessage.id)

    expect(row?.preview).toBe(`@${displayProfileByPubkey(viewer)} test`)
    expect(row?.preview).not.toContain("profile")
  })

  it("does not label room replies when the parent is outside the same room", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const parentMessage = makeEvent({
      id: "parent-message",
      kind: MESSAGE,
      pubkey: viewer,
      created_at: 90,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-two"],
      ],
    })
    const replyMessage = makeEvent({
      id: "reply-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 100,
      content: "reply in another room",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
        ["q", parentMessage.id, "", viewer],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [replyMessage],
      targetEvents: [parentMessage],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
    })

    expect(rows.find(row => row.eventId === replyMessage.id)).toBeUndefined()
  })

  it("does not notify original room message authors for second-order room replies", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const parentMessage = makeEvent({
      id: "parent-message",
      kind: MESSAGE,
      pubkey: viewer,
      created_at: 90,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
      ],
    })
    const firstReply = makeEvent({
      id: "first-reply",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 100,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
        ["q", parentMessage.id, "", viewer],
      ],
    })
    const secondReply = makeEvent({
      id: "second-reply",
      kind: MESSAGE,
      pubkey: outsider,
      created_at: 110,
      content: "reply to the reply",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "room-one"],
        ["q", firstReply.id, "", writer],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [secondReply],
      targetEvents: [parentMessage, firstReply],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
    })

    expect(rows.find(row => row.eventId === secondReply.id)).toBeUndefined()
  })

  it("notifies only thread replies to the signed-in user's comments", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const parentComment = makeEvent({
      id: "parent-comment",
      kind: COMMENT,
      pubkey: viewer,
      created_at: 90,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "thread-one"],
        ["K", String(THREAD)],
      ],
    })
    const commentReply = makeEvent({
      id: "comment-reply",
      kind: COMMENT,
      pubkey: writer,
      created_at: 110,
      content: "reply to your comment",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "thread-one"],
        ["K", String(THREAD)],
        ["e", parentComment.id, "", viewer],
        ["k", String(COMMENT)],
        ["p", viewer],
      ],
    })
    const rootThreadReply = makeEvent({
      id: "root-thread-reply",
      kind: COMMENT,
      pubkey: writer,
      created_at: 120,
      content: "reply to thread root",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "thread-one"],
        ["K", String(THREAD)],
        ["P", viewer],
      ],
    })
    const foreignParentComment = makeEvent({
      id: "foreign-parent-comment",
      kind: COMMENT,
      pubkey: viewer,
      created_at: 90,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "thread-two"],
        ["K", String(THREAD)],
      ],
    })
    const crossThreadReply = makeEvent({
      id: "cross-thread-reply",
      kind: COMMENT,
      pubkey: writer,
      created_at: 130,
      content: "reply to a parent in another thread",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "thread-one"],
        ["K", String(THREAD)],
        ["e", foreignParentComment.id, "", viewer],
        ["k", String(COMMENT)],
        ["p", viewer],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [commentReply, rootThreadReply, crossThreadReply],
      targetEvents: [parentComment, foreignParentComment],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
    })

    expect(rows.map(row => row.eventId)).toEqual([commentReply.id])
    expect(rows.map(row => row.eventId)).not.toEqual(
      expect.arrayContaining([rootThreadReply.id, crossThreadReply.id]),
    )
    expect(rows.find(row => row.eventId === commentReply.id)).toEqual(
      expect.objectContaining({
        source: "community",
        type: "reply",
        title: "New thread comment reply",
        path: expect.stringContaining("/threads/thread-one"),
        target: expect.objectContaining({label: "Context", eventId: parentComment.id}),
      }),
    )
  })

  it("notifies thread creators for nested comments under their thread", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const threadRoot = makeEvent({
      id: "thread-root",
      kind: THREAD,
      pubkey: viewer,
      created_at: 80,
      tags: [
        ["h", notificationCommunity.communityId],
        ["title", "A thread"],
      ],
    })
    const firstComment = makeEvent({
      id: "first-comment",
      kind: COMMENT,
      pubkey: writer,
      created_at: 100,
      content: "first comment",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", threadRoot.id, "", viewer],
        ["K", String(THREAD)],
        ["P", viewer],
      ],
    })
    const nestedComment = makeEvent({
      id: "nested-comment",
      kind: COMMENT,
      pubkey: writer,
      created_at: 110,
      content: "nested comment",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", threadRoot.id, "", viewer],
        ["K", String(THREAD)],
        ["P", viewer],
        ["e", firstComment.id, "", writer],
        ["k", String(COMMENT)],
        ["p", writer],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [nestedComment],
      targetEvents: [threadRoot, firstComment],
      profileListEvents: [makeProfileList(), makeProfileList(threadProfileListAddress)],
      currentPubkey: viewer,
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
    })

    expect(rows.find(row => row.eventId === nestedComment.id)).toEqual(
      expect.objectContaining({
        source: "community",
        type: "reply",
        title: "New thread comment",
        action: "commented",
        contextLabel: "on your thread",
        path: expect.stringContaining("/threads/thread-root"),
        target: expect.objectContaining({label: "Your thread", eventId: threadRoot.id}),
      }),
    )
  })

  it("notifies calendar event creators for nested comments under their event", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeTargetedCommunityRef()
    const calendarRoot = makeEvent({
      id: "8".repeat(64),
      kind: EVENT_TIME,
      pubkey: viewer,
      created_at: 80,
      tags: [
        ["h", notificationCommunity.communityId],
        ["d", "calendar-root"],
      ],
    })
    const firstComment = makeEvent({
      id: "calendar-first-comment",
      kind: COMMENT,
      pubkey: writer,
      created_at: 100,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", calendarRoot.id, "", viewer],
        ["K", String(EVENT_TIME)],
        ["P", viewer],
        ["e", calendarRoot.id, "", viewer],
        ["k", String(EVENT_TIME)],
        ["p", viewer],
      ],
    })
    const nestedComment = makeEvent({
      id: "calendar-nested-comment",
      kind: COMMENT,
      pubkey: writer,
      created_at: 110,
      content: "nested calendar comment",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", calendarRoot.id, "", viewer],
        ["K", String(EVENT_TIME)],
        ["P", viewer],
        ["e", firstComment.id, "", writer],
        ["k", String(COMMENT)],
        ["p", writer],
      ],
    })
    const targetingEvent = makeTargetingEvent({
      id: "calendar-targeting",
      kind: EVENT_TIME,
      originalId: calendarRoot.id,
    })
    const unauthorizedTargetingEvent = makeTargetingEvent({
      id: "unauthorized-calendar-targeting",
      kind: EVENT_TIME,
      originalId: calendarRoot.id,
      pubkey: outsider,
    })

    expect(
      buildCommunityNotificationRows({
        refs: [ref],
        events: [nestedComment],
        targetEvents: [calendarRoot, firstComment, unauthorizedTargetingEvent],
        profileListEvents: [makeProfileList(), makeProfileList(calendarProfileListAddress)],
        currentPubkey: viewer,
        reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
      }).find(row => row.eventId === nestedComment.id),
    ).toBeUndefined()

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [nestedComment],
      targetEvents: [calendarRoot, firstComment, targetingEvent],
      profileListEvents: [makeProfileList(), makeProfileList(calendarProfileListAddress)],
      currentPubkey: viewer,
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
    })

    expect(rows.find(row => row.eventId === nestedComment.id)).toEqual(
      expect.objectContaining({
        source: "community",
        type: "reply",
        title: "New calendar comment",
        action: "commented",
        contextLabel: "on your calendar event",
        path: expect.stringContaining(`/calendar/${calendarRoot.id}`),
        target: expect.objectContaining({label: "Your calendar event", eventId: calendarRoot.id}),
      }),
    )
  })

  it("notifies goal creators for nested comments under their goal", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeTargetedCommunityRef()
    const goalRoot = makeEvent({
      id: "9".repeat(64),
      kind: ZAP_GOAL,
      pubkey: viewer,
      created_at: 80,
      tags: [
        ["h", notificationCommunity.communityId],
        ["d", "goal-root"],
      ],
    })
    const firstComment = makeEvent({
      id: "goal-first-comment",
      kind: COMMENT,
      pubkey: writer,
      created_at: 100,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", goalRoot.id, "", viewer],
        ["K", String(ZAP_GOAL)],
        ["P", viewer],
        ["e", goalRoot.id, "", viewer],
        ["k", String(ZAP_GOAL)],
        ["p", viewer],
      ],
    })
    const nestedComment = makeEvent({
      id: "goal-nested-comment",
      kind: COMMENT,
      pubkey: writer,
      created_at: 110,
      content: "nested goal comment",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", goalRoot.id, "", viewer],
        ["K", String(ZAP_GOAL)],
        ["P", viewer],
        ["e", firstComment.id, "", writer],
        ["k", String(COMMENT)],
        ["p", writer],
      ],
    })
    const targetingEvent = makeTargetingEvent({
      id: "goal-targeting",
      kind: ZAP_GOAL,
      originalId: goalRoot.id,
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [nestedComment],
      targetEvents: [goalRoot, firstComment, targetingEvent],
      profileListEvents: [makeProfileList(), makeProfileList(goalProfileListAddress)],
      currentPubkey: viewer,
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
    })

    expect(rows.find(row => row.eventId === nestedComment.id)).toEqual(
      expect.objectContaining({
        source: "community",
        type: "reply",
        title: "New goal comment",
        action: "commented",
        contextLabel: "on your goal",
        path: expect.stringContaining(`/goals/${goalRoot.id}`),
        target: expect.objectContaining({label: "Your goal", eventId: goalRoot.id}),
      }),
    )
  })

  it("builds targeted engagement rows without generic p-tag noise", async () => {
    const {buildEngagementNotificationRows} = await import("./notification-sources")
    const ownedCommentId = "3".repeat(64)
    const otherCommentId = "4".repeat(64)
    const replyId = "5".repeat(64)
    const mentionId = "6".repeat(64)
    const inheritedReplyTagId = "7".repeat(64)
    const ignoredBoostId = "8".repeat(64)
    const genericMentionId = "9".repeat(64)
    const ownedComment = makeEvent({
      id: ownedCommentId,
      kind: COMMENT,
      pubkey: viewer,
      content: "my comment",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "thread-one"],
        ["K", String(THREAD)],
      ],
    })
    const otherComment = makeEvent({
      id: otherCommentId,
      kind: COMMENT,
      pubkey: outsider,
      content: "other comment",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "thread-two"],
        ["K", String(THREAD)],
      ],
    })
    const reply = makeEvent({
      id: replyId,
      kind: COMMENT,
      pubkey: writer,
      created_at: 110,
      content: "replying to your comment",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "thread-one"],
        ["K", String(THREAD)],
        ["e", ownedComment.id, "", "reply"],
        ["k", String(COMMENT)],
        ["p", viewer],
      ],
    })
    const mention = makeEvent({
      id: mentionId,
      kind: COMMENT,
      pubkey: writer,
      created_at: 120,
      content: "hi #[0]",
      tags: [
        ["p", viewer],
        ["h", notificationCommunity.communityId],
        ["E", "thread-one"],
        ["K", String(THREAD)],
      ],
    })
    const genericMention = makeEvent({
      id: genericMentionId,
      kind: COMMENT,
      pubkey: outsider,
      created_at: 125,
      content: "hi #[0]",
      tags: [["p", viewer]],
    })
    const inheritedReplyTag = makeEvent({
      id: inheritedReplyTagId,
      kind: COMMENT,
      pubkey: writer,
      created_at: 130,
      content: "replying elsewhere",
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "thread-two"],
        ["K", String(THREAD)],
        ["e", otherComment.id, "", "reply"],
        ["k", String(COMMENT)],
        ["p", viewer],
      ],
    })
    const ignoredBoost = makeEvent({
      id: ignoredBoostId,
      kind: 6,
      pubkey: writer,
      created_at: 140,
      tags: [
        ["e", ownedComment.id],
        ["p", viewer],
      ],
    })

    const rows = buildEngagementNotificationRows({
      events: [reply, mention, genericMention, inheritedReplyTag, ignoredBoost],
      targetEvents: [ownedComment, otherComment],
      refs: [makeCommunityRef()],
      profileListEvents: [makeProfileList()],
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
      currentPubkey: viewer,
    })

    expect(rows.map(row => row.eventId)).toEqual([mentionId, replyId])
    expect(rows.find(row => row.eventId === reply.id)).toEqual(
      expect.objectContaining({
        source: "community",
        sourceLabel: "Communities",
        type: "reply",
        title: "New reply",
        actorPubkey: writer,
        path: expect.stringContaining("/threads/thread-one"),
        target: expect.objectContaining({label: "your comment", eventId: ownedComment.id}),
        detail: expect.objectContaining({label: "New reply", eventId: reply.id}),
      }),
    )
    expect(rows.find(row => row.eventId === mention.id)).toEqual(
      expect.objectContaining({
        source: "community",
        sourceLabel: "Communities",
        type: "mention",
        title: "New mention",
        actorPubkey: writer,
        path: expect.stringContaining("/threads/thread-one"),
        detail: expect.objectContaining({label: "New mention", eventId: mention.id}),
      }),
    )
    expect(rows.map(row => row.eventId)).not.toEqual(
      expect.arrayContaining([genericMention.id, inheritedReplyTag.id, ignoredBoost.id]),
    )
  })

  it("enforces current community grants on engagement while allowing zaps", async () => {
    const {buildEngagementNotificationRows} = await import("./notification-sources")
    const target = makeEvent({
      id: "community-engagement-target",
      kind: COMMENT,
      pubkey: viewer,
      tags: [
        ["h", notificationCommunity.communityId],
        ["E", "thread-one"],
        ["K", String(THREAD)],
      ],
    })
    const makeReply = (id: string, pubkey: string) =>
      makeEvent({
        id,
        kind: COMMENT,
        pubkey,
        created_at: 200,
        content: "reply",
        tags: [
          ["h", notificationCommunity.communityId],
          ["E", "thread-one"],
          ["K", String(THREAD)],
          ["e", target.id, "", viewer],
          ["k", String(COMMENT)],
          ["p", viewer],
        ],
      })
    const makeReaction = (id: string, pubkey: string) =>
      makeEvent({
        id,
        kind: REACTION,
        pubkey,
        created_at: 210,
        content: "+",
        tags: [
          ["h", notificationCommunity.communityId],
          ["e", target.id],
          ["p", viewer],
        ],
      })
    const allowedReply = makeReply("allowed-community-reply", writer)
    const outsiderReply = makeReply("outsider-community-reply", outsider)
    const allowedReaction = makeReaction("allowed-community-reaction", writer)
    const outsiderReaction = makeReaction("outsider-community-reaction", outsider)
    const zap = makeEvent({
      id: "community-zap",
      kind: ZAP_RESPONSE,
      pubkey: zapper,
      created_at: 220,
      tags: [
        ["p", viewer],
        ["e", target.id],
        [
          "description",
          JSON.stringify({
            pubkey: outsider,
            tags: [
              ["e", target.id],
              ["p", viewer],
            ],
          }),
        ],
      ],
    })
    const options = {
      events: [allowedReply, outsiderReply, allowedReaction, outsiderReaction, zap],
      targetEvents: [target],
      refs: [makeCommunityRef()],
      profileListEvents: [makeProfileList()],
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
      currentPubkey: viewer,
      validZapResponseIds: new Set([zap.id]),
    }
    const rows = buildEngagementNotificationRows(options)
    const displayedIds = rows.flatMap(row => row.eventIds || [row.eventId])

    expect(displayedIds).toEqual(
      expect.arrayContaining([allowedReply.id, allowedReaction.id, zap.id]),
    )
    expect(displayedIds).not.toEqual(
      expect.arrayContaining([outsiderReply.id, outsiderReaction.id]),
    )
    expect(buildEngagementNotificationRows({...options, reportStates: undefined})).toEqual([])
  })

  it("admits targetable engagement context only through authorized wrapper semantics", async () => {
    const {buildEngagementNotificationRows} = await import("./notification-sources")
    const calendar = makeEvent({
      id: "a".repeat(64),
      kind: EVENT_TIME,
      pubkey: viewer,
      tags: [["d", "external-calendar"]],
    })
    const reaction = makeEvent({
      id: "external-calendar-reaction",
      kind: REACTION,
      pubkey: writer,
      tags: [
        ["e", calendar.id],
        ["p", viewer],
      ],
    })
    const explicitWrapper = makeTargetingEvent({
      id: "explicit-calendar-wrapper",
      kind: EVENT_TIME,
      originalId: calendar.id,
    })
    const siblingWrapper = makeEvent({
      id: "sibling-calendar-wrapper",
      pubkey: communityPubkey,
      ...buildTargetedPublication({
        id: "sibling-calendar-target",
        kind: EVENT_TIME,
        source: {type: "e", value: calendar.id},
        communities: [siblingCommunity],
      }),
    })
    const v1ShapedWrapper = makeEvent({
      id: "v1-shaped-calendar-wrapper",
      kind: TARGETED_PUBLICATION_KIND,
      pubkey: communityPubkey,
      content: "",
      tags: [
        ["d", "legacy"],
        ["k", String(EVENT_TIME)],
        ["p", zapper],
      ],
    })
    const base = {
      events: [reaction],
      refs: [makeTargetedCommunityRef()],
      profileListEvents: [makeProfileList(), makeProfileList(calendarProfileListAddress)],
      reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
      currentPubkey: viewer,
    }

    expect(
      buildEngagementNotificationRows({
        ...base,
        targetEvents: [calendar, explicitWrapper, siblingWrapper, v1ShapedWrapper],
      }),
    ).toEqual([
      expect.objectContaining({
        type: "reaction",
        source: "community",
        path: expect.stringContaining(`/calendar/${calendar.id}`),
        target: expect.objectContaining({eventId: calendar.id}),
      }),
    ])

    const removedWrapper = makeEvent({
      id: "explicit-calendar-wrapper-removed",
      kind: TARGETED_PUBLICATION_KIND,
      pubkey: communityPubkey,
      created_at: explicitWrapper.created_at + 1,
      content: "",
      tags: buildTargetedPublication({
        id: "explicit-calendar-wrapper-target",
        kind: EVENT_TIME,
        source: {type: "a", value: `${EVENT_TIME}:${viewer}:${calendar.id}`},
        communities: [siblingCommunity],
      }).tags,
    })
    const wrapperDeletion = makeEvent({
      id: "explicit-calendar-wrapper-delete",
      kind: DELETE,
      pubkey: communityPubkey,
      tags: [
        ["a", `${TARGETED_PUBLICATION_KIND}:${communityPubkey}:explicit-calendar-wrapper-target`],
      ],
    })

    expect(
      buildEngagementNotificationRows({
        ...base,
        targetEvents: [calendar, explicitWrapper, removedWrapper],
      }),
    ).toEqual([])
    expect(
      buildEngagementNotificationRows({
        ...base,
        targetEvents: [calendar, explicitWrapper, wrapperDeletion],
      }),
    ).toEqual([])

    const implicitCalendar = makeEvent({
      ...calendar,
      id: "implicit-calendar",
      tags: [
        ["d", "implicit-calendar"],
        ["h", "implicit-target"],
      ],
    })
    const implicitReaction = makeEvent({
      ...reaction,
      id: "implicit-calendar-reaction",
      tags: [
        ["e", implicitCalendar.id],
        ["p", viewer],
      ],
    })
    const implicitWrapper = makeEvent({
      id: "implicit-calendar-wrapper",
      kind: TARGETED_PUBLICATION_KIND,
      pubkey: communityPubkey,
      content: "",
      tags: buildTargetedPublication({
        id: "implicit-target",
        kind: EVENT_TIME,
        communities: [notificationCommunity],
      }).tags,
    })

    expect(
      buildEngagementNotificationRows({
        ...base,
        events: [implicitReaction],
        targetEvents: [implicitCalendar, implicitWrapper],
      }),
    ).toEqual([])
  })

  it("admits either calendar event kind through the opposite calendar grant", async () => {
    const {buildEngagementNotificationRows} = await import("./notification-sources")

    for (const [grantedKind, admittedKind] of [
      [EVENT_TIME, EVENT_DATE],
      [EVENT_DATE, EVENT_TIME],
    ] as const) {
      const ref = makeTargetedCommunityRef()
      const calendarSection = ref.definition.sections.find(
        section => section.name === COMMUNITY_SECTION_CALENDAR,
      )!
      const calendar = makeEvent({
        id: admittedKind === EVENT_TIME ? "b".repeat(64) : "c".repeat(64),
        kind: admittedKind,
        pubkey: viewer,
        tags: [["d", `cross-kind-calendar-${admittedKind}`]],
      })
      const reaction = makeEvent({
        id: `cross-kind-reaction-${admittedKind}`,
        kind: REACTION,
        pubkey: writer,
        tags: [
          ["e", calendar.id],
          ["p", viewer],
        ],
      })
      const wrapper = makeTargetingEvent({
        id: `cross-kind-wrapper-${admittedKind}`,
        kind: admittedKind,
        originalId: calendar.id,
        pubkey: writer,
      })

      ref.definition = {
        ...ref.definition,
        sections: ref.definition.sections.map(section =>
          section === calendarSection ? {...section, kinds: [{kind: grantedKind}]} : section,
        ),
      }

      expect(
        buildEngagementNotificationRows({
          events: [reaction],
          targetEvents: [calendar, wrapper],
          refs: [ref],
          profileListEvents: [makeProfileList(), makeProfileList(calendarProfileListAddress)],
          reportStates: new Map([[notificationCommunity.address, emptyReportState]]),
          currentPubkey: viewer,
        }),
      ).toEqual([
        expect.objectContaining({
          type: "reaction",
          source: "community",
          path: expect.stringContaining(`/calendar/${calendar.id}`),
        }),
      ])
    }
  })

  it("uses current same-author wrapper replacements and deletions", async () => {
    const {makeTargetingWrapperReplacementFilters, selectCurrentTargetingWrapperEvents} =
      await import("./notification-sources")
    const original = makeTargetingEvent({
      id: "wrapper-original",
      kind: EVENT_TIME,
      originalId: "calendar-original",
      pubkey: writer,
    })
    original.created_at = 100
    const replacement = makeEvent({
      id: "wrapper-replacement",
      kind: TARGETED_PUBLICATION_KIND,
      pubkey: writer,
      created_at: 200,
      content: "",
      tags: buildTargetedPublication({
        id: "wrapper-original-target",
        kind: EVENT_TIME,
        source: {type: "a", value: `${EVENT_TIME}:${viewer}:calendar-original`},
        communities: [siblingCommunity],
      }).tags,
    })
    const deletion = makeEvent({
      id: "wrapper-deletion",
      kind: DELETE,
      pubkey: writer,
      created_at: 300,
      tags: [["a", `${TARGETED_PUBLICATION_KIND}:${writer}:wrapper-original-target`]],
    })
    const addressDeletion = makeEvent({
      id: "wrapper-address-deletion",
      kind: DELETE,
      pubkey: writer,
      created_at: 300,
      tags: [["a", `${TARGETED_PUBLICATION_KIND}:${writer}:wrapper-original-target`]],
    })
    const foreignDeletion = makeEvent({...deletion, id: "foreign-deletion", pubkey: outsider})

    expect(makeTargetingWrapperReplacementFilters([original])).toEqual([
      {
        kinds: [TARGETED_PUBLICATION_KIND],
        authors: [writer],
        "#d": ["wrapper-original-target"],
        limit: 1,
      },
    ])
    expect(selectCurrentTargetingWrapperEvents([original, replacement])).toEqual([replacement])
    expect(selectCurrentTargetingWrapperEvents([original, replacement], [foreignDeletion])).toEqual(
      [replacement],
    )
    expect(selectCurrentTargetingWrapperEvents([original, replacement], [deletion])).toEqual([])
    expect(selectCurrentTargetingWrapperEvents([original, replacement], [addressDeletion])).toEqual(
      [],
    )
  })

  it("notifies issue creators for nested git comments under their issue", async () => {
    const {buildEngagementNotificationRows} = await import("./notification-sources")
    const repoAddress = `${GIT_REPO_ANNOUNCEMENT}:${viewer}:repo`
    const issue = makeEvent({
      id: "issue-root",
      kind: GIT_ISSUE,
      pubkey: viewer,
      created_at: 80,
      content: "Important issue",
      tags: [["a", repoAddress]],
    })
    const firstComment = makeEvent({
      id: "issue-first-comment",
      kind: GIT_COMMENT,
      pubkey: writer,
      created_at: 100,
      tags: [
        ["E", issue.id, "", viewer],
        ["K", String(GIT_ISSUE)],
        ["P", viewer],
        ["e", issue.id, "", viewer],
        ["k", String(GIT_ISSUE)],
        ["p", viewer],
        ["q", repoAddress],
      ],
    })
    const nestedComment = makeEvent({
      id: "issue-nested-comment",
      kind: GIT_COMMENT,
      pubkey: writer,
      created_at: 110,
      content: "nested issue comment",
      tags: [
        ["E", issue.id, "", viewer],
        ["K", String(GIT_ISSUE)],
        ["P", viewer],
        ["e", firstComment.id, "", writer],
        ["k", String(GIT_COMMENT)],
        ["p", writer],
        ["q", repoAddress],
      ],
    })

    const rows = buildEngagementNotificationRows({
      events: [nestedComment],
      targetEvents: [issue, firstComment],
      currentPubkey: viewer,
    })

    expect(rows.find(row => row.eventId === nestedComment.id)).toEqual(
      expect.objectContaining({
        source: "git",
        sourceLabel: "Git",
        type: "reply",
        title: "New reply",
        contextLabel: "to your issue",
        path: expect.stringContaining("/git/"),
        target: expect.objectContaining({label: "your issue", eventId: issue.id}),
      }),
    )
  })

  it("notifies pull request creators for pull request updates", async () => {
    const {buildEngagementNotificationRows} = await import("./notification-sources")
    const repoAddress = `${GIT_REPO_ANNOUNCEMENT}:${viewer}:repo`
    const pullRequest = makeEvent({
      id: "pr-root",
      kind: GIT_PULL_REQUEST,
      pubkey: viewer,
      created_at: 80,
      content: "Important PR",
      tags: [["a", repoAddress]],
    })
    const update = makeEvent({
      id: "pr-update",
      kind: GIT_PULL_REQUEST_UPDATE,
      pubkey: writer,
      created_at: 120,
      content: "pushed more commits",
      tags: [
        ["a", repoAddress],
        ["E", pullRequest.id, "", viewer],
        ["P", viewer],
      ],
    })

    const rows = buildEngagementNotificationRows({
      events: [update],
      targetEvents: [pullRequest],
      currentPubkey: viewer,
    })

    expect(rows.find(row => row.eventId === update.id)).toEqual(
      expect.objectContaining({
        source: "git",
        sourceLabel: "Git",
        type: "repo",
        title: "Pull request update",
        action: "updated a pull request",
        contextLabel: "on your pull request",
        path: expect.stringContaining("/prs/pr-root"),
      }),
    )
  })

  it("notifies issue creators for status changes", async () => {
    const {buildEngagementNotificationRows} = await import("./notification-sources")
    const repoAddress = `${GIT_REPO_ANNOUNCEMENT}:${viewer}:repo`
    const issue = makeEvent({
      id: "status-issue-root",
      kind: GIT_ISSUE,
      pubkey: viewer,
      created_at: 80,
      tags: [["a", repoAddress]],
    })
    const status = makeEvent({
      id: "issue-status",
      kind: GIT_STATUS_CLOSED,
      pubkey: writer,
      created_at: 120,
      content: "closed",
      tags: [
        ["a", repoAddress],
        ["e", issue.id, "", "root"],
        ["p", viewer],
        ["K", String(GIT_ISSUE)],
      ],
    })

    const rows = buildEngagementNotificationRows({
      events: [status],
      targetEvents: [issue],
      currentPubkey: viewer,
    })

    expect(rows.find(row => row.eventId === status.id)).toEqual(
      expect.objectContaining({
        source: "git",
        sourceLabel: "Git",
        type: "repo",
        title: "Git status update",
        action: "updated status",
        contextLabel: "on your issue",
        path: expect.stringContaining("/issues/status-issue-root"),
      }),
    )
  })

  it("still notifies only direct git comment parents for direct parent replies", async () => {
    const {buildEngagementNotificationRows} = await import("./notification-sources")
    const repoAddress = `${GIT_REPO_ANNOUNCEMENT}:${viewer}:repo`
    const issue = makeEvent({
      id: "parent-issue-root",
      kind: GIT_ISSUE,
      pubkey: outsider,
      created_at: 80,
      tags: [["a", repoAddress]],
    })
    const parentComment = makeEvent({
      id: "viewer-git-comment",
      kind: GIT_COMMENT,
      pubkey: viewer,
      created_at: 100,
      tags: [
        ["E", issue.id, "", outsider],
        ["K", String(GIT_ISSUE)],
        ["P", outsider],
        ["e", issue.id, "", outsider],
        ["k", String(GIT_ISSUE)],
        ["p", outsider],
        ["q", repoAddress],
      ],
    })
    const reply = makeEvent({
      id: "viewer-git-comment-reply",
      kind: GIT_COMMENT,
      pubkey: writer,
      created_at: 110,
      content: "reply to your git comment",
      tags: [
        ["E", issue.id, "", outsider],
        ["K", String(GIT_ISSUE)],
        ["P", outsider],
        ["e", parentComment.id, "", viewer],
        ["k", String(GIT_COMMENT)],
        ["p", viewer],
        ["q", repoAddress],
      ],
    })

    const rows = buildEngagementNotificationRows({
      events: [reply],
      targetEvents: [issue, parentComment],
      currentPubkey: viewer,
    })

    expect(rows.find(row => row.eventId === reply.id)).toEqual(
      expect.objectContaining({
        source: "git",
        type: "reply",
        contextLabel: "to your git comment",
        target: expect.objectContaining({label: "your git comment", eventId: parentComment.id}),
      }),
    )
  })

  it("does not notify issue creators for reactions to someone else's git comment", async () => {
    const {buildEngagementNotificationRows} = await import("./notification-sources")
    const repoAddress = `${GIT_REPO_ANNOUNCEMENT}:${viewer}:repo`
    const issue = makeEvent({
      id: "reaction-issue-root",
      kind: GIT_ISSUE,
      pubkey: viewer,
      created_at: 80,
      tags: [["a", repoAddress]],
    })
    const comment = makeEvent({
      id: "other-git-comment",
      kind: GIT_COMMENT,
      pubkey: writer,
      created_at: 100,
      tags: [
        ["E", issue.id, "", viewer],
        ["K", String(GIT_ISSUE)],
        ["P", viewer],
        ["q", repoAddress],
      ],
    })
    const reaction = makeEvent({
      id: "comment-reaction",
      kind: REACTION,
      pubkey: outsider,
      created_at: 110,
      content: "+",
      tags: [
        ["e", comment.id],
        ["p", viewer],
      ],
    })

    const rows = buildEngagementNotificationRows({
      events: [reaction],
      targetEvents: [issue, comment],
      currentPubkey: viewer,
    })

    expect(rows.flatMap(row => row.eventIds || [row.eventId])).not.toEqual(
      expect.arrayContaining([reaction.id]),
    )
  })

  it("groups reactions and verified zaps only for signed-in user's targets", async () => {
    const {buildEngagementNotificationRows} = await import("./notification-sources")
    const ownedCommentId = "3".repeat(64)
    const otherCommentId = "4".repeat(64)
    const reactionOneId = "5".repeat(64)
    const reactionTwoId = "6".repeat(64)
    const falseReactionId = "7".repeat(64)
    const validZapId = "8".repeat(64)
    const invalidZapId = "9".repeat(64)
    const falseZapId = "0".repeat(64)
    const genericCommentId = "d".repeat(64)
    const genericReactionId = "e".repeat(64)
    const repoAddress = `${GIT_REPO_ANNOUNCEMENT}:${viewer}:repo`
    const ownedComment = makeEvent({
      id: ownedCommentId,
      kind: GIT_ISSUE,
      pubkey: viewer,
      content: "my issue",
      tags: [["a", repoAddress]],
    })
    const otherComment = makeEvent({
      id: otherCommentId,
      kind: GIT_ISSUE,
      pubkey: outsider,
      content: "other issue",
      tags: [["a", repoAddress]],
    })
    const genericComment = makeEvent({
      id: genericCommentId,
      kind: COMMENT,
      pubkey: viewer,
      content: "my public comment",
    })
    const reactionOne = makeEvent({
      id: reactionOneId,
      kind: REACTION,
      pubkey: writer,
      created_at: 100,
      content: "+",
      tags: [
        ["e", ownedComment.id],
        ["p", viewer],
      ],
    })
    const reactionTwo = makeEvent({
      id: reactionTwoId,
      kind: REACTION,
      pubkey: outsider,
      created_at: 120,
      content: "fire",
      tags: [
        ["e", ownedComment.id],
        ["p", viewer],
      ],
    })
    const falseReaction = makeEvent({
      id: falseReactionId,
      kind: REACTION,
      pubkey: writer,
      created_at: 130,
      content: "+",
      tags: [
        ["e", otherComment.id],
        ["p", viewer],
      ],
    })
    const genericReaction = makeEvent({
      id: genericReactionId,
      kind: REACTION,
      pubkey: writer,
      created_at: 135,
      content: "+",
      tags: [
        ["e", genericComment.id],
        ["p", viewer],
      ],
    })
    const zapRequest = {
      pubkey: writer,
      content: "nice post",
      tags: [
        ["p", viewer],
        ["e", ownedComment.id],
        ["amount", "21000"],
      ],
    }
    const validZap = makeEvent({
      id: validZapId,
      kind: ZAP_RESPONSE,
      pubkey: zapper,
      created_at: 140,
      tags: [
        ["p", viewer],
        ["e", ownedComment.id],
        ["description", JSON.stringify(zapRequest)],
      ],
    })
    const invalidZap = makeEvent({
      id: invalidZapId,
      kind: ZAP_RESPONSE,
      pubkey: zapper,
      created_at: 150,
      tags: [
        ["p", viewer],
        ["e", ownedComment.id],
        ["description", JSON.stringify(zapRequest)],
      ],
    })
    const falseZap = makeEvent({
      id: falseZapId,
      kind: ZAP_RESPONSE,
      pubkey: zapper,
      created_at: 160,
      tags: [
        ["p", viewer],
        ["e", otherComment.id],
        [
          "description",
          JSON.stringify({
            ...zapRequest,
            tags: [
              ["e", otherComment.id],
              ["p", viewer],
            ],
          }),
        ],
      ],
    })

    const rows = buildEngagementNotificationRows({
      events: [
        reactionOne,
        reactionTwo,
        falseReaction,
        genericReaction,
        validZap,
        invalidZap,
        falseZap,
      ],
      targetEvents: [ownedComment, otherComment, genericComment],
      currentPubkey: viewer,
      validZapResponseIds: new Set([validZap.id, falseZap.id]),
    })
    const reactionRow = rows.find(row => row.title === "New reactions")
    const zapRow = rows.find(row => row.title === "New zap")

    expect(reactionRow).toEqual(
      expect.objectContaining({
        source: "git",
        sourceLabel: "Git",
        type: "reaction",
        eventId: reactionTwo.id,
        eventIds: [reactionTwo.id, reactionOne.id],
        id: expect.stringContaining(ownedComment.id),
        path: expect.stringContaining("/git/"),
        target: expect.objectContaining({label: "your issue", eventId: ownedComment.id}),
      }),
    )
    expect(zapRow).toEqual(
      expect.objectContaining({
        source: "git",
        sourceLabel: "Git",
        type: "zap",
        eventId: validZap.id,
        actorPubkey: writer,
        eventIds: [validZap.id],
        preview: expect.stringContaining("nice post"),
        path: expect.stringContaining("/git/"),
        target: expect.objectContaining({label: "your issue", eventId: ownedComment.id}),
      }),
    )
    expect(rows.flatMap(row => row.eventIds || [row.eventId])).not.toEqual(
      expect.arrayContaining([falseReaction.id, genericReaction.id, invalidZap.id, falseZap.id]),
    )
  })
})
