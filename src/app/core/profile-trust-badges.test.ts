import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  parseCommunityDefinition,
  type CommunityDefinition,
} from "@app/core/community"
import type {ActiveUserCommunityRef} from "@app/core/community-membership"
import {
  makeCommunityEventReport,
  makeCommunityPersonReport,
  type EffectiveCommunityReportState,
} from "@app/core/community-reports"
import {
  getProfileFlagReportEvidence,
  getSharedProfileCommunityEvidenceGroups,
} from "./profile-trust-badges"

const targetPubkey = "a".repeat(64)
const sharedCommunityPubkey = "b".repeat(64)
const otherSharedCommunityPubkey = "c".repeat(64)
const unsharedCommunityPubkey = "d".repeat(64)
const memberListOwner = "e".repeat(64)
const otherMemberListOwner = "f".repeat(64)
const viewerPubkey = "9".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: "1".repeat(64),
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeDefinition = ({
  id,
  pubkey,
  sections,
}: {
  id: string
  pubkey: string
  sections: Array<{name: string; profileListAddresses: string[]}>
}) =>
  parseCommunityDefinition(
    makeEvent({
      id,
      pubkey,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: [
        ["r", "wss://relay.example.com"],
        ...sections.flatMap(section => [
          ["content", section.name],
          ["k", "1111"],
          ...section.profileListAddresses.map(address => ["a", address]),
        ]),
      ],
    }),
  )!

const makeProfileList = ({
  id,
  pubkey,
  identifier,
  members = [],
}: {
  id: string
  pubkey: string
  identifier: string
  members?: string[]
}) =>
  makeEvent({
    id,
    pubkey,
    kind: PROFILE_LIST_KIND,
    tags: [["d", identifier], ...members.map(member => ["p", member])],
  })

const makeViewerRef = (definition: CommunityDefinition) =>
  ({
    communityPubkey: definition.pubkey,
    definition,
    relayHints: definition.relays,
    roles: ["member"],
    writableSections: definition.sections.map(section => section.name),
  }) as ActiveUserCommunityRef

const makeReportState = (targetPubkeys: string[]): EffectiveCommunityReportState =>
  ({
    eventReports: [],
    personReports: targetPubkeys.map((targetPubkey, index) => ({
      target: "person",
      targetPubkey,
      communityPubkey: sharedCommunityPubkey,
      communityAddress: `${COMMUNITY_DEFINITION_KIND}:${sharedCommunityPubkey}:`,
      reporterPubkey: `reporter-${index}`,
      adminAuthored: true,
      event: makeEvent({id: `report-${index}`, created_at: index}),
    })),
  }) as EffectiveCommunityReportState

describe("profile trust badges", () => {
  it("only presents community role evidence shared with the logged-in user", () => {
    const sharedAddress = `${PROFILE_LIST_KIND}:${memberListOwner}:General`
    const unsharedModeratorAddress = `${PROFILE_LIST_KIND}:${targetPubkey}:General`
    const sharedDefinition = makeDefinition({
      id: "shared",
      pubkey: sharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: [sharedAddress]}],
    })
    const unsharedDefinition = makeDefinition({
      id: "unshared",
      pubkey: unsharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: [unsharedModeratorAddress]}],
    })
    const groups = getSharedProfileCommunityEvidenceGroups({
      targetPubkey,
      viewerCommunityRefs: [makeViewerRef(sharedDefinition)],
      profileListEvents: [
        makeProfileList({
          id: "shared-member-list",
          pubkey: memberListOwner,
          identifier: "General",
          members: [targetPubkey],
        }),
        makeProfileList({
          id: "unshared-moderator-list",
          pubkey: targetPubkey,
          identifier: "General",
        }),
      ],
    })

    expect(unsharedDefinition.pubkey).toBe(unsharedCommunityPubkey)
    expect(groups.map(group => group.role)).toEqual(["member"])
    expect(groups[0].items.map(item => item.communityPubkey)).toEqual([sharedCommunityPubkey])
  })

  it("uses only the highest ranked role per shared community", () => {
    const moderatorAddress = `${PROFILE_LIST_KIND}:${targetPubkey}:General`
    const memberAddress = `${PROFILE_LIST_KIND}:${memberListOwner}:General`
    const definition = makeDefinition({
      id: "shared",
      pubkey: sharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: [moderatorAddress, memberAddress]}],
    })
    const groups = getSharedProfileCommunityEvidenceGroups({
      targetPubkey,
      viewerCommunityRefs: [makeViewerRef(definition)],
      profileListEvents: [
        makeProfileList({id: "moderator-list", pubkey: targetPubkey, identifier: "General"}),
        makeProfileList({
          id: "member-list",
          pubkey: memberListOwner,
          identifier: "General",
          members: [targetPubkey],
        }),
      ],
    })

    expect(groups.map(group => group.role)).toEqual(["moderator"])
    expect(groups[0].items[0]).toMatchObject({
      communityPubkey: sharedCommunityPubkey,
      sectionCount: 1,
      grantCount: 0,
    })
  })

  it("groups repeated moderator evidence and keeps section counts per community", () => {
    const sharedGeneralAddress = `${PROFILE_LIST_KIND}:${targetPubkey}:General`
    const sharedReposAddress = `${PROFILE_LIST_KIND}:${targetPubkey}:Repositories`
    const otherSharedGeneralAddress = `${PROFILE_LIST_KIND}:${targetPubkey}:OtherGeneral`
    const sharedDefinition = makeDefinition({
      id: "shared",
      pubkey: sharedCommunityPubkey,
      sections: [
        {name: "General", profileListAddresses: [sharedGeneralAddress]},
        {name: "Repositories", profileListAddresses: [sharedReposAddress]},
      ],
    })
    const otherSharedDefinition = makeDefinition({
      id: "other-shared",
      pubkey: otherSharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: [otherSharedGeneralAddress]}],
    })
    const groups = getSharedProfileCommunityEvidenceGroups({
      targetPubkey,
      viewerCommunityRefs: [makeViewerRef(sharedDefinition), makeViewerRef(otherSharedDefinition)],
      profileListEvents: [
        makeProfileList({id: "shared-general", pubkey: targetPubkey, identifier: "General"}),
        makeProfileList({id: "shared-repos", pubkey: targetPubkey, identifier: "Repositories"}),
        makeProfileList({
          id: "other-shared-general",
          pubkey: targetPubkey,
          identifier: "OtherGeneral",
        }),
      ],
    })
    const moderatorGroup = groups.find(group => group.role === "moderator")

    expect(moderatorGroup?.items).toHaveLength(2)
    expect(moderatorGroup?.items.map(item => item.sectionCount)).toEqual([2, 1])
  })

  it("adds ban evidence only from communities the logged-in user belongs to", () => {
    const sharedAddress = `${PROFILE_LIST_KIND}:${memberListOwner}:General`
    const otherSharedAddress = `${PROFILE_LIST_KIND}:${otherMemberListOwner}:General`
    const sharedDefinition = makeDefinition({
      id: "shared",
      pubkey: sharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: [sharedAddress]}],
    })
    const otherSharedDefinition = makeDefinition({
      id: "other-shared",
      pubkey: otherSharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: [otherSharedAddress]}],
    })
    const groups = getSharedProfileCommunityEvidenceGroups({
      targetPubkey,
      viewerCommunityRefs: [makeViewerRef(sharedDefinition), makeViewerRef(otherSharedDefinition)],
      profileListEvents: [
        makeProfileList({
          id: "shared-member-list",
          pubkey: memberListOwner,
          identifier: "General",
          members: [targetPubkey],
        }),
      ],
      reportStates: new Map([
        [sharedCommunityPubkey, makeReportState([targetPubkey])],
        [otherSharedCommunityPubkey, makeReportState([targetPubkey])],
        [unsharedCommunityPubkey, makeReportState([targetPubkey])],
      ]),
    })

    expect(groups.map(group => group.role)).toEqual(["banned"])
    expect(groups[0].items.map(item => item.communityPubkey)).toEqual([
      sharedCommunityPubkey,
      otherSharedCommunityPubkey,
    ])
  })

  it("collects only the logged-in user's event-targeted reports in shared communities", () => {
    const sharedDefinition = makeDefinition({
      id: "shared",
      pubkey: sharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: []}],
    })
    const otherReporter = "8".repeat(64)
    const ownEventReport = makeEvent({
      id: "own-event-report",
      pubkey: viewerPubkey,
      ...makeCommunityEventReport({
        communityPubkey: sharedCommunityPubkey,
        sectionName: "General",
        eventId: "reported-event",
        eventPubkey: targetPubkey,
        eventKind: 1,
        eventTitle: "Reported note",
        eventContent: "Reported content snapshot",
        content: "Off-topic",
      }),
    })
    const ownPersonReport = makeEvent({
      id: "own-person-report",
      pubkey: viewerPubkey,
      ...makeCommunityPersonReport({communityPubkey: sharedCommunityPubkey, pubkey: targetPubkey}),
    })
    const otherReporterEventReport = makeEvent({
      id: "other-reporter-event-report",
      pubkey: otherReporter,
      ...makeCommunityEventReport({
        communityPubkey: sharedCommunityPubkey,
        sectionName: "General",
        eventId: "other-reported-event",
        eventPubkey: targetPubkey,
      }),
    })
    const unsharedEventReport = makeEvent({
      id: "unshared-event-report",
      pubkey: viewerPubkey,
      ...makeCommunityEventReport({
        communityPubkey: unsharedCommunityPubkey,
        sectionName: "General",
        eventId: "unshared-reported-event",
        eventPubkey: targetPubkey,
      }),
    })

    const reports = getProfileFlagReportEvidence({
      targetPubkey,
      viewerPubkey,
      viewerCommunityRefs: [makeViewerRef(sharedDefinition)],
      reportEvents: [
        ownEventReport,
        ownPersonReport,
        otherReporterEventReport,
        unsharedEventReport,
      ],
    })

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      communityPubkey: sharedCommunityPubkey,
      targetEventId: "reported-event",
      targetEventKind: 1,
      targetEventTitle: "Reported note",
      targetEventContent: "Reported content snapshot",
      reason: "spam",
      reportContent: "Off-topic",
    })
  })

  it("preserves addressable flag metadata when the report target is an address", () => {
    const sharedDefinition = makeDefinition({
      id: "shared",
      pubkey: sharedCommunityPubkey,
      sections: [{name: "General", profileListAddresses: []}],
    })
    const targetAddress = `31922:${targetPubkey}:calendar-1`
    const addressReport = makeEvent({
      id: "address-report",
      pubkey: viewerPubkey,
      kind: 1984,
      tags: [
        ["a", targetAddress, "wss://relay.example.com", "malware"],
        ["p", targetPubkey],
        ["a", `${COMMUNITY_DEFINITION_KIND}:${sharedCommunityPubkey}:`],
        ["content", "General"],
      ],
    })

    const reports = getProfileFlagReportEvidence({
      targetPubkey,
      viewerPubkey,
      viewerCommunityRefs: [makeViewerRef(sharedDefinition)],
      reportEvents: [addressReport],
    })

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      targetAddress,
      targetEventKind: 31922,
      targetIdentifier: "calendar-1",
      reason: "malware",
    })
  })
})
