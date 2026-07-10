// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"
import {readable} from "svelte/store"
import {nip19} from "nostr-tools"
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
  COMMUNITY_SECTION_THREADS,
  FORM_RESPONSE_KIND,
  FORM_TEMPLATE_KIND,
  PROFILE_LIST_KIND,
} from "@app/core/community"
import {COMMUNITY_FORM_REVIEW_KIND} from "@app/core/community-forms"
import {
  COMMUNITY_REPORT_KIND,
  COMMUNITY_REPORT_REVIEW_LABEL_KIND,
  COMMUNITY_REPORT_REVIEW_NAMESPACE,
  COMMUNITY_REPORT_REVIEWED_LABEL,
} from "@app/core/community-reports"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
}))

vi.mock("@app/core/repo-watch", () => ({
  repoWatchNotificationSeen: readable({}),
}))

vi.mock("@app/util/repo-watch-notifications", () => ({
  repoWatchNotificationCandidates: readable([]),
}))

vi.mock("@app/extensions/widget-update-notifications", () => ({
  installedWidgetUpdates: readable([]),
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

const viewer = "a".repeat(64)
const writer = "b".repeat(64)
const outsider = "c".repeat(64)
const banned = "d".repeat(64)
const muted = "e".repeat(64)
const communityPubkey = "f".repeat(64)
const profileListPubkey = "1".repeat(64)
const zapper = "2".repeat(64)
const profileListAddress = `${PROFILE_LIST_KIND}:${profileListPubkey}:${COMMUNITY_SECTION_GENERAL}`
const threadProfileListAddress = `${PROFILE_LIST_KIND}:${profileListPubkey}:${COMMUNITY_SECTION_THREADS}`

const makeCommunityRef = (): ActiveUserCommunityRef => ({
  communityPubkey,
  relayHints: [],
  roles: ["member"],
  writableSections: [COMMUNITY_SECTION_GENERAL, COMMUNITY_SECTION_THREADS],
  definition: {
    event: makeEvent({id: "community", kind: 10222, pubkey: communityPubkey}),
    pubkey: communityPubkey,
    relays: [],
    blossomServers: [],
    mints: [],
    sections: [
      {
        name: COMMUNITY_SECTION_GENERAL,
        kinds: [{kind: MESSAGE, subtype: "room-message"}, {kind: COMMENT}],
        profileLists: [
          {
            kind: PROFILE_LIST_KIND,
            pubkey: profileListPubkey,
            identifier: COMMUNITY_SECTION_GENERAL,
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
            kind: PROFILE_LIST_KIND,
            pubkey: profileListPubkey,
            identifier: COMMUNITY_SECTION_THREADS,
            address: threadProfileListAddress,
          },
        ],
        badges: [],
        retention: [],
      },
    ],
  },
})

const makeProfileList = (address = profileListAddress) => {
  const [, pubkey, identifier] = address.split(":")

  return makeEvent({
    id: `profile-list-${identifier}`,
    kind: PROFILE_LIST_KIND,
    pubkey,
    tags: [
      ["d", identifier],
      ["p", writer],
      ["p", viewer],
    ],
  })
}

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
        ["h", communityPubkey],
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
        kind: PROFILE_LIST_KIND,
        pubkey: viewer,
        identifier: COMMUNITY_SECTION_GENERAL,
        address: generalProfileListAddress,
      },
    ]
    ref.definition.sections[1].profileLists = [
      {
        kind: PROFILE_LIST_KIND,
        pubkey: outsider,
        identifier: COMMUNITY_SECTION_THREADS,
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
        ["a", `10222:${communityPubkey}:`],
        ["content", COMMUNITY_SECTION_GENERAL],
        ["name", "General application"],
      ],
    })
    const threadForm = makeEvent({
      id: "thread-form",
      kind: FORM_TEMPLATE_KIND,
      pubkey: outsider,
      tags: [
        ["d", "threads-application"],
        ["a", `10222:${communityPubkey}:`],
        ["content", COMMUNITY_SECTION_THREADS],
        ["name", "Threads application"],
      ],
    })
    const generalResponse = makeEvent({
      id: "general-response",
      kind: FORM_RESPONSE_KIND,
      pubkey: writer,
      created_at: 140,
      tags: [
        ["a", generalFormAddress],
        ["response", "q1", "I would like to post updates."],
      ],
    })
    const threadResponse = makeEvent({
      id: "thread-response",
      kind: FORM_RESPONSE_KIND,
      pubkey: writer,
      created_at: 150,
      tags: [
        ["a", threadFormAddress],
        ["response", "q1", "I would like to create threads."],
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
    const formAddress = `${FORM_TEMPLATE_KIND}:${writer}:calendar-application`
    const form = makeEvent({
      id: "calendar-form",
      kind: FORM_TEMPLATE_KIND,
      pubkey: writer,
      tags: [
        ["d", "calendar-application"],
        ["a", `10222:${communityPubkey}:`],
        ["content", COMMUNITY_SECTION_CALENDAR],
        ["name", "Calendar application"],
      ],
    })
    const accepted = makeEvent({
      id: "calendar-accepted",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: writer,
      created_at: 220,
      content: "+",
      tags: [
        ["e", "calendar-response"],
        ["p", viewer],
        ["k", String(FORM_RESPONSE_KIND)],
        ["a", formAddress],
        ["h", communityPubkey],
        ["content", COMMUNITY_SECTION_CALENDAR],
      ],
    })
    const revoked = makeEvent({
      id: "calendar-revoked",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: writer,
      created_at: 240,
      content: "-",
      tags: [
        ["e", "calendar-response"],
        ["p", viewer],
        ["k", String(FORM_RESPONSE_KIND)],
        ["a", formAddress],
        ["h", communityPubkey],
        ["content", COMMUNITY_SECTION_CALENDAR],
      ],
    })

    const rows = buildCommunityApplicationNotificationRows({
      refs: [],
      currentPubkey: viewer,
      admissionFormEvents: [form],
      admissionReviewEvents: [accepted, revoked],
    })

    expect(rows).toEqual([
      expect.objectContaining({
        source: "community",
        title: "Publishing access revoked",
        action: "revoked your access to publish in",
        actorPubkey: writer,
        path: expect.stringContaining("/access"),
        eventId: revoked.id,
      }),
      expect.objectContaining({
        source: "community",
        title: "Publishing request approved",
        action: "approved your request to publish in",
        actorPubkey: writer,
        path: expect.stringContaining("/access"),
        eventId: accepted.id,
      }),
    ])
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
        expect.objectContaining({kinds: [MESSAGE], "#h": [communityPubkey], since: 10}),
        expect.objectContaining({kinds: [COMMENT], "#h": [communityPubkey], since: 10}),
        expect.objectContaining({
          kinds: [MESSAGE],
          "#h": [communityPubkey],
          "#p": [viewer],
          since: 10,
        }),
        expect.objectContaining({
          kinds: [COMMENT],
          "#h": [communityPubkey],
          "#p": [viewer],
          since: 10,
        }),
      ]),
    )
  })

  it("keeps user-specific community access and suppresses generic community rows", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const allowedMessage = makeEvent({
      id: "allowed-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 50,
      content: "hello community",
      tags: [
        ["h", communityPubkey],
        ["E", "room-one"],
      ],
    })
    const outsiderMessage = makeEvent({
      id: "outsider-message",
      kind: MESSAGE,
      pubkey: outsider,
      created_at: 60,
      tags: [
        ["h", communityPubkey],
        ["E", "room-two"],
      ],
    })
    const bannedMessage = makeEvent({
      id: "banned-message",
      kind: MESSAGE,
      pubkey: banned,
      created_at: 70,
      tags: [
        ["h", communityPubkey],
        ["E", "room-three"],
      ],
    })
    const mutedMessage = makeEvent({
      id: "muted-message",
      kind: MESSAGE,
      pubkey: muted,
      created_at: 80,
      tags: [
        ["h", communityPubkey],
        ["E", "room-four"],
      ],
    })
    const censoredMessage = makeEvent({
      id: "censored-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 90,
      tags: [
        ["h", communityPubkey],
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
          communityPubkey,
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

    expect(rows.map(row => row.eventId)).toEqual(expect.arrayContaining(["profile-list-General"]))
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
    expect(rows.find(row => row.eventId === "profile-list-General")).toEqual(
      expect.objectContaining({
        source: "community",
        title: "Community membership updated",
      }),
    )
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
          communityPubkey,
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
      kind: COMMUNITY_REPORT_KIND,
      pubkey: writer,
      created_at: 150,
      tags: [
        ["e", "reported-event", "spam"],
        ["p", viewer],
        ["a", `10222:${communityPubkey}:`],
        ["h", communityPubkey],
        ["content", COMMUNITY_SECTION_GENERAL],
        ["target-kind", String(COMMENT)],
        ["target-content", "Reported comment"],
      ],
    })

    expect(
      buildCommunityModerationNotificationRows({
        refs: [ref],
        currentPubkey: viewer,
        profileListEvents: [makeProfileList()],
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
      kind: COMMUNITY_REPORT_KIND,
      pubkey: writer,
      created_at: 120,
      tags: [
        ["e", "reported-event", "spam"],
        ["p", viewer],
        ["a", `10222:${communityPubkey}:`],
        ["h", communityPubkey],
        ["content", COMMUNITY_SECTION_GENERAL],
        ["target-kind", String(COMMENT)],
        ["target-content", "Reported comment"],
      ],
    })
    const censor = makeEvent({
      id: "censor-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: profileListPubkey,
      created_at: 160,
      tags: [
        ["e", "reported-event", "spam"],
        ["p", viewer],
        ["a", `10222:${communityPubkey}:`],
        ["h", communityPubkey],
        ["content", COMMUNITY_SECTION_GENERAL],
        ["target-kind", String(COMMENT)],
        ["target-content", "Reported comment"],
      ],
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
        reportStates: new Map([[communityPubkey, reportState]]),
      }).map(row => row.title),
    ).toEqual(["Reported content moderated"])
    expect(
      buildCommunityModerationNotificationRows({
        refs: [ref],
        currentPubkey: communityPubkey,
        profileListEvents: [makeProfileList()],
        reportEvents: [contentReport, censor],
        reportStates: new Map([[communityPubkey, reportState]]),
      }).map(row => row.title),
    ).toEqual(["Content moderated", "New content report"])
  })

  it("notifies reporters when reports are reviewed and suppresses deleted reports", async () => {
    const {buildCommunityModerationNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    ref.definition.sections[0].kinds.push({kind: COMMUNITY_REPORT_KIND})
    const report = makeEvent({
      id: "reviewed-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: writer,
      created_at: 120,
      tags: [
        ["e", "reported-event", "spam"],
        ["p", viewer],
        ["a", `10222:${communityPubkey}:`],
        ["h", communityPubkey],
        ["content", COMMUNITY_SECTION_GENERAL],
        ["target-kind", String(COMMENT)],
      ],
    })
    const review = makeEvent({
      id: "report-review",
      kind: COMMUNITY_REPORT_REVIEW_LABEL_KIND,
      pubkey: profileListPubkey,
      created_at: 160,
      tags: [
        ["L", COMMUNITY_REPORT_REVIEW_NAMESPACE],
        ["l", COMMUNITY_REPORT_REVIEWED_LABEL, COMMUNITY_REPORT_REVIEW_NAMESPACE],
        ["e", report.id],
        ["a", `10222:${communityPubkey}:`],
        ["h", communityPubkey],
        ["E", "reported-event"],
        ["K", String(COMMENT)],
        ["content", COMMUNITY_SECTION_GENERAL],
      ],
    })
    const deletion = makeEvent({
      id: "report-delete",
      kind: DELETE,
      pubkey: writer,
      created_at: 170,
      tags: [
        ["e", report.id],
        ["k", String(COMMUNITY_REPORT_KIND)],
      ],
    })

    expect(
      buildCommunityModerationNotificationRows({
        refs: [ref],
        currentPubkey: writer,
        profileListEvents: [makeProfileList()],
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
      kind: COMMUNITY_REPORT_KIND,
      pubkey: communityPubkey,
      created_at: 180,
      content: "banned for spam",
      tags: [
        ["p", banned, "spam"],
        ["a", `10222:${communityPubkey}:`],
        ["h", communityPubkey],
      ],
    })

    expect(
      buildCommunityModerationNotificationRows({
        refs: [ref],
        currentPubkey: viewer,
        reportStates: new Map([
          [
            communityPubkey,
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
  })

  it("builds repo-watch rows with readable labels and seen paths", async () => {
    const {buildRepoWatchNotificationRows} = await import("./notification-sources")
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

    expect(
      buildRepoWatchNotificationRows({
        candidates: [{path, latestEvent: comment}],
      })[0],
    ).toEqual(
      expect.objectContaining({
        title: "New git comment",
        path: `${path}/${issue.id}#comment-${comment.id}`,
      }),
    )

    expect(
      buildRepoWatchNotificationRows({
        candidates: [{path, latestEvent: status}],
      })[0]?.path,
    ).toBe(`${path}/${issue.id}`)
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
      appUrl: "https://example.com/v2.html",
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
        ["h", communityPubkey],
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
        ["h", communityPubkey],
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

  it("labels community room replies when the parent is not loaded but q tags the signed-in user", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const replyMessage = makeEvent({
      id: "reply-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 100,
      content: "reply in room",
      tags: [
        ["h", communityPubkey],
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
    })

    expect(rows.find(row => row.eventId === replyMessage.id)).toEqual(
      expect.objectContaining({
        source: "community",
        type: "reply",
        title: "New room reply",
        actorPubkey: writer,
        path: expect.stringContaining("/rooms/room-one"),
        target: undefined,
        detail: expect.objectContaining({label: "New room reply", eventId: replyMessage.id}),
      }),
    )
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
        ["h", communityPubkey],
        ["E", "room-one"],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [mentionMessage],
      targetEvents: [],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
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
        ["h", communityPubkey],
        ["E", "room-one"],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [mentionMessage],
      targetEvents: [],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
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
        ["h", communityPubkey],
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
        ["h", communityPubkey],
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
        ["h", communityPubkey],
        ["E", "room-one"],
      ],
    })
    const firstReply = makeEvent({
      id: "first-reply",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 100,
      tags: [
        ["h", communityPubkey],
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
        ["h", communityPubkey],
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
        ["h", communityPubkey],
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
        ["h", communityPubkey],
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
        ["h", communityPubkey],
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
        ["h", communityPubkey],
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
        ["h", communityPubkey],
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
    })

    expect(rows.map(row => row.eventId)).toEqual(
      expect.arrayContaining(["profile-list-General", commentReply.id]),
    )
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
        ["h", communityPubkey],
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
        ["h", communityPubkey],
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
        ["h", communityPubkey],
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
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
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
    const ref = makeCommunityRef()
    const calendarRoot = makeEvent({
      id: "calendar-root",
      kind: EVENT_TIME,
      pubkey: viewer,
      created_at: 80,
      tags: [
        ["h", communityPubkey],
        ["d", "calendar-root"],
      ],
    })
    const firstComment = makeEvent({
      id: "calendar-first-comment",
      kind: COMMENT,
      pubkey: writer,
      created_at: 100,
      tags: [
        ["h", communityPubkey],
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
        ["h", communityPubkey],
        ["E", calendarRoot.id, "", viewer],
        ["K", String(EVENT_TIME)],
        ["P", viewer],
        ["e", firstComment.id, "", writer],
        ["k", String(COMMENT)],
        ["p", writer],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [nestedComment],
      targetEvents: [calendarRoot, firstComment],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
    })

    expect(rows.find(row => row.eventId === nestedComment.id)).toEqual(
      expect.objectContaining({
        source: "community",
        type: "reply",
        title: "New calendar comment",
        action: "commented",
        contextLabel: "on your calendar event",
        path: expect.stringContaining("/calendar/calendar-root"),
        target: expect.objectContaining({label: "Your calendar event", eventId: calendarRoot.id}),
      }),
    )
  })

  it("notifies goal creators for nested comments under their goal", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const goalRoot = makeEvent({
      id: "goal-root",
      kind: ZAP_GOAL,
      pubkey: viewer,
      created_at: 80,
      tags: [["h", communityPubkey]],
    })
    const firstComment = makeEvent({
      id: "goal-first-comment",
      kind: COMMENT,
      pubkey: writer,
      created_at: 100,
      tags: [
        ["h", communityPubkey],
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
        ["h", communityPubkey],
        ["E", goalRoot.id, "", viewer],
        ["K", String(ZAP_GOAL)],
        ["P", viewer],
        ["e", firstComment.id, "", writer],
        ["k", String(COMMENT)],
        ["p", writer],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [nestedComment],
      targetEvents: [goalRoot, firstComment],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
    })

    expect(rows.find(row => row.eventId === nestedComment.id)).toEqual(
      expect.objectContaining({
        source: "community",
        type: "reply",
        title: "New goal comment",
        action: "commented",
        contextLabel: "on your goal",
        path: expect.stringContaining("/goals/goal-root"),
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
        ["h", communityPubkey],
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
        ["h", communityPubkey],
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
        ["h", communityPubkey],
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
      pubkey: outsider,
      created_at: 120,
      content: "hi #[0]",
      tags: [
        ["p", viewer],
        ["h", communityPubkey],
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
        ["h", communityPubkey],
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
        actorPubkey: outsider,
        path: expect.stringContaining("/threads/thread-one"),
        detail: expect.objectContaining({label: "New mention", eventId: mention.id}),
      }),
    )
    expect(rows.map(row => row.eventId)).not.toEqual(
      expect.arrayContaining([genericMention.id, inheritedReplyTag.id, ignoredBoost.id]),
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
