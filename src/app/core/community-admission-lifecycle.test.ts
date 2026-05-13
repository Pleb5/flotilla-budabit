import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  BADGE_DEFINITION_KIND,
  COMMUNITY_DEFINITION_KIND,
  FORM_RESPONSE_KIND,
  FORM_TEMPLATE_KIND,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  parseCommunityDefinition,
} from "./community"
import {makeCommunityGrantEvents} from "./community-admin"
import {makeTargetedPublicationForCommunity, makeAddressablePublicationRef} from "./community-targeting"
import {makeTargetedPublicationOriginalFilters} from "./community-feeds"
import {
  COMMUNITY_WRITE_TARGETS,
  canWriteCommunityTarget,
  getCommunityPublishGateState,
  getCommunitySectionWriterPubkeys,
} from "./community-permissions"
import {
  makeAdmissionFormAddress,
  makeAdmissionFormTemplate,
  makeAdmissionResponse,
  makeAdmissionResponseDelete,
  makeAdmissionReview,
  selectActiveAdmissionForm,
  getAdmissionSubmissionState,
} from "./community-forms"

const communityPubkey = "a".repeat(64)
const moderatorPubkey = "b".repeat(64)
const applicantPubkey = "c".repeat(64)
const outsiderPubkey = "d".repeat(64)
const approvedCalendarPubkey = "e".repeat(64)
const unauthorizedCalendarPubkey = "f".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: moderatorPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const generalListRef = {
  kind: PROFILE_LIST_KIND,
  pubkey: moderatorPubkey,
  identifier: "General",
  address: `${PROFILE_LIST_KIND}:${moderatorPubkey}:General`,
}
const repoListRef = {
  kind: PROFILE_LIST_KIND,
  pubkey: moderatorPubkey,
  identifier: "Repositories",
  address: `${PROFILE_LIST_KIND}:${moderatorPubkey}:Repositories`,
}
const calendarListRef = {
  kind: PROFILE_LIST_KIND,
  pubkey: moderatorPubkey,
  identifier: "Calendar",
  address: `${PROFILE_LIST_KIND}:${moderatorPubkey}:Calendar`,
}
const generalBadgeRef = {
  kind: BADGE_DEFINITION_KIND,
  pubkey: moderatorPubkey,
  identifier: "General",
  address: `${BADGE_DEFINITION_KIND}:${moderatorPubkey}:General`,
}
const repoBadgeRef = {
  kind: BADGE_DEFINITION_KIND,
  pubkey: moderatorPubkey,
  identifier: "Repositories",
  address: `${BADGE_DEFINITION_KIND}:${moderatorPubkey}:Repositories`,
}
const calendarBadgeRef = {
  kind: BADGE_DEFINITION_KIND,
  pubkey: moderatorPubkey,
  identifier: "Calendar",
  address: `${BADGE_DEFINITION_KIND}:${moderatorPubkey}:Calendar`,
}

const definition = parseCommunityDefinition(
  makeEvent({
    id: "community-definition",
    kind: COMMUNITY_DEFINITION_KIND,
    pubkey: communityPubkey,
    tags: [
      ["r", "wss://community.example"],
      ["content", "General"],
      ["k", "9", "room-message"],
      ["k", "1111"],
      ["k", "7"],
      ["a", generalListRef.address],
      ["badge", generalBadgeRef.address],
      ["content", "Repositories"],
      ["k", "30617"],
      ["a", repoListRef.address],
      ["badge", repoBadgeRef.address],
      ["content", "Calendar"],
      ["k", "31922"],
      ["a", calendarListRef.address],
      ["badge", calendarBadgeRef.address],
    ],
  }),
)!

const formTemplate = makeAdmissionFormTemplate({
  identifier: "general-application",
  communityPubkey,
  sectionName: "General",
  name: "General application",
  fields: [
    {id: "intro", label: "Why should we grant access?"},
    {id: "rules", type: "label", label: "Community rules apply."},
    {
      id: "focus",
      type: "option",
      label: "Primary focus",
      options: [
        {id: "rooms", label: "Rooms"},
        {id: "threads", label: "Threads"},
      ],
    },
  ],
})
const form = selectActiveAdmissionForm({
  events: [
    makeEvent({id: "outsider-form", pubkey: outsiderPubkey, kind: FORM_TEMPLATE_KIND, tags: formTemplate.tags}),
    makeEvent({id: "active-form", pubkey: moderatorPubkey, kind: FORM_TEMPLATE_KIND, tags: formTemplate.tags}),
  ],
  communityPubkey,
  sectionName: "General",
  moderatorPubkeys: [moderatorPubkey],
})!
const formAddress = makeAdmissionFormAddress(moderatorPubkey, "general-application")

describe("community admission lifecycle integration", () => {
  it("covers application, duplicate prevention, delete/resubmit, review, grants, gates, and filtered reads", () => {
    expect(form.event.id).toBe("active-form")
    expect(form.fields.focus.type).toBe("option")

    const firstResponse = makeEvent({
      id: "response-1",
      kind: FORM_RESPONSE_KIND,
      pubkey: applicantPubkey,
      created_at: 10,
      tags: makeAdmissionResponse({
        formAddress,
        values: {intro: "I build room tools.", focus: "rooms"},
      }).tags,
    })
    const duplicateResponse = makeEvent({
      id: "response-2",
      kind: FORM_RESPONSE_KIND,
      pubkey: applicantPubkey,
      created_at: 11,
      tags: makeAdmissionResponse({
        formAddress,
        values: {intro: "A duplicate active submission.", focus: "threads"},
      }).tags,
    })

    expect(
      getAdmissionSubmissionState({
        responseEvents: [firstResponse, duplicateResponse],
        deleteEvents: [],
        reviewEvents: [],
        formAddress,
        applicantPubkey,
        moderatorPubkeys: [moderatorPubkey],
      }).response?.event.id,
    ).toBe("response-2")

    const deleteDuplicate = makeEvent({
      id: "delete-response-2",
      kind: 5,
      pubkey: applicantPubkey,
      created_at: 12,
      tags: makeAdmissionResponseDelete({responseId: "response-2"}).tags,
    })
    const revisedResponse = makeEvent({
      id: "response-3",
      kind: FORM_RESPONSE_KIND,
      pubkey: applicantPubkey,
      created_at: 13,
      tags: makeAdmissionResponse({
        formAddress,
        values: {intro: "A revised application.", focus: "threads"},
      }).tags,
    })
    const rejection = makeEvent({
      id: "reject-response-3",
      kind: 7,
      pubkey: moderatorPubkey,
      created_at: 14,
      content: "-",
      tags: makeAdmissionReview({
        responseId: "response-3",
        applicantPubkey,
        status: "rejected",
      }).tags,
    })
    const grantReview = makeEvent({
      id: "grant-response-3",
      kind: 7,
      pubkey: moderatorPubkey,
      created_at: 15,
      content: "+",
      tags: makeAdmissionReview({
        responseId: "response-3",
        applicantPubkey,
        status: "granted",
      }).tags,
    })

    expect(
      getAdmissionSubmissionState({
        responseEvents: [firstResponse, duplicateResponse, revisedResponse],
        deleteEvents: [deleteDuplicate],
        reviewEvents: [rejection],
        formAddress,
        applicantPubkey,
        moderatorPubkeys: [moderatorPubkey],
      }).status,
    ).toBe("rejected")
    expect(
      getAdmissionSubmissionState({
        responseEvents: [firstResponse, duplicateResponse, revisedResponse],
        deleteEvents: [deleteDuplicate],
        reviewEvents: [rejection, grantReview],
        formAddress,
        applicantPubkey,
        moderatorPubkeys: [moderatorPubkey],
      }).status,
    ).toBe("granted")

    expect(
      getCommunityPublishGateState({
        definition,
        profileListEvents: [],
        userPubkey: applicantPubkey,
        target: COMMUNITY_WRITE_TARGETS.comment,
        form,
        responseEvents: [revisedResponse],
      }).status,
    ).toBe("pending")

    const grantEvents = makeCommunityGrantEvents({
      profileList: generalListRef,
      badge: generalBadgeRef,
      pubkey: applicantPubkey,
    })
    const grantedProfileList = makeEvent({
      id: "general-list-granted",
      kind: PROFILE_LIST_KIND,
      pubkey: moderatorPubkey,
      tags: grantEvents.profileList.tags,
    })

    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [grantedProfileList],
        userPubkey: applicantPubkey,
        target: COMMUNITY_WRITE_TARGETS.comment,
      }),
    ).toBe(true)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [grantedProfileList],
        userPubkey: applicantPubkey,
        target: COMMUNITY_WRITE_TARGETS.repository,
      }),
    ).toBe(false)

    const calendarList = makeEvent({
      id: "calendar-list",
      kind: PROFILE_LIST_KIND,
      pubkey: moderatorPubkey,
      tags: [
        ["d", "Calendar"],
        ["p", approvedCalendarPubkey],
      ],
    })
    const calendarAuthors = getCommunitySectionWriterPubkeys({
      definition,
      profileListEvents: [calendarList],
      sectionName: "Calendar",
    })
    const approvedTargeting = makeEvent({
      id: "approved-targeting",
      kind: TARGETED_PUBLICATION_KIND,
      pubkey: approvedCalendarPubkey,
      tags: makeTargetedPublicationForCommunity({
        targetingId: "approved-event",
        originalKind: 31922,
        originalRef: makeAddressablePublicationRef({
          kind: 31922,
          pubkey: approvedCalendarPubkey,
          identifier: "approved-event",
        }),
        communityPubkey,
      }).tags,
    })
    const unauthorizedTargeting = makeEvent({
      id: "unauthorized-targeting",
      kind: TARGETED_PUBLICATION_KIND,
      pubkey: unauthorizedCalendarPubkey,
      tags: makeTargetedPublicationForCommunity({
        targetingId: "unauthorized-event",
        originalKind: 31922,
        originalRef: makeAddressablePublicationRef({
          kind: 31922,
          pubkey: unauthorizedCalendarPubkey,
          identifier: "unauthorized-event",
        }),
        communityPubkey,
      }).tags,
    })

    expect(
      makeTargetedPublicationOriginalFilters(
        [approvedTargeting, unauthorizedTargeting],
        calendarAuthors,
      ),
    ).toEqual([{kinds: [31922], authors: [approvedCalendarPubkey], "#d": ["approved-event"]}])
  })
})
