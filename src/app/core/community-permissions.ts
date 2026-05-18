import type {TrustedEvent} from "@welshman/util"
import {
  getAdmissionSubmissionState,
  type CommunityAdmissionForm,
  type CommunityFormReview,
  type CommunityFormResponse,
} from "@app/core/community-forms"
import {
  COMMUNITY_SECTION_CALENDAR,
  COMMUNITY_SECTION_GENERAL,
  COMMUNITY_SECTION_GOALS,
  COMMUNITY_SECTION_PERMALINKS,
  COMMUNITY_SECTION_REPOSITORIES,
  COMMUNITY_SECTION_ROOMS,
  COMMUNITY_SECTION_THREADS,
  COMMUNITY_SECTION_WIDGETS,
  COMMUNITY_SUBTYPE_ROOM,
  COMMUNITY_SUBTYPE_ROOM_MESSAGE,
  COMMUNITY_SUBTYPE_THREADS,
  type AddressRef,
  type CommunityDefinition,
  type CommunityProfileListRef,
  type CommunitySection,
  findCommunitySection,
  getProfileListPubkeys,
  normalizeCommunitySectionSubtype,
  normalizePubkey,
  sectionSupportsKind,
  userCanManageProfileList,
} from "@app/core/community"
import {GIT_PERMALINK_KIND, SMART_WIDGET_KIND} from "@app/core/community-feeds"
import type {EffectiveCommunityReportState} from "@app/core/community-reports"
import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"

export type CommunityWriteTarget = {
  sectionName: string
  kind: number
  subtype?: string
}

export type CommunityGrantCapability = {
  canManageList: boolean
  canGrant: boolean
  profileList?: CommunityProfileListRef
}

export type CommunityPublishCapability = CommunityWriteTarget & {
  key: string
  canWrite: boolean
}

export type CommunityPublishGateStatus =
  | "allowed"
  | "banned"
  | "login-required"
  | "missing"
  | "pending"
  | "rejected"
  | "granted"

export type CommunityPublishGateState = CommunityWriteTarget & {
  status: CommunityPublishGateStatus
  form?: CommunityAdmissionForm
  response?: CommunityFormResponse
  review?: CommunityFormReview
}

export const COMMUNITY_WRITE_TARGETS = {
  roomRoot: {sectionName: COMMUNITY_SECTION_ROOMS, kind: 11, subtype: COMMUNITY_SUBTYPE_ROOM},
  roomMessage: {
    sectionName: COMMUNITY_SECTION_GENERAL,
    kind: 9,
    subtype: COMMUNITY_SUBTYPE_ROOM_MESSAGE,
  },
  thread: {sectionName: COMMUNITY_SECTION_THREADS, kind: 11, subtype: COMMUNITY_SUBTYPE_THREADS},
  comment: {sectionName: COMMUNITY_SECTION_GENERAL, kind: 1111},
  reaction: {sectionName: COMMUNITY_SECTION_GENERAL, kind: 7},
  label: {sectionName: COMMUNITY_SECTION_GENERAL, kind: 1985},
  calendar: {sectionName: COMMUNITY_SECTION_CALENDAR, kind: 31922},
  goal: {sectionName: COMMUNITY_SECTION_GOALS, kind: 9041},
  repository: {sectionName: COMMUNITY_SECTION_REPOSITORIES, kind: GIT_REPO_ANNOUNCEMENT},
  permalink: {sectionName: COMMUNITY_SECTION_PERMALINKS, kind: GIT_PERMALINK_KIND},
  widget: {sectionName: COMMUNITY_SECTION_WIDGETS, kind: SMART_WIDGET_KIND},
} satisfies Record<string, CommunityWriteTarget>

export const getCommunityWriteTarget = (
  kind: number,
  subtype?: string,
): CommunityWriteTarget | undefined => {
  const normalizedSubtype = normalizeCommunitySectionSubtype(subtype)

  return (Object.values(COMMUNITY_WRITE_TARGETS) as CommunityWriteTarget[]).find(
    target => target.kind === kind && (!normalizedSubtype || target.subtype === normalizedSubtype),
  )
}

export const getCommunityCapabilityKey = (kind: number, subtype?: string) => {
  const normalizedSubtype = normalizeCommunitySectionSubtype(subtype)

  return normalizedSubtype ? `${kind}:${normalizedSubtype}` : String(kind)
}

export const getPrimaryProfileListRef = (section: CommunitySection | undefined) =>
  section?.profileLists[0]

export const isCommunityReportStatePersonBanned = (
  reportState: EffectiveCommunityReportState | undefined,
  pubkey: string | undefined,
) => {
  const normalizedPubkey = normalizePubkey(pubkey || "")

  return Boolean(
    normalizedPubkey &&
      reportState?.personReports.some(report => report.targetPubkey === normalizedPubkey),
  )
}

const getAddress = (event: TrustedEvent) => {
  const d = event.tags.find(tag => tag[0] === "d")?.[1]
  return d ? `${event.kind}:${event.pubkey}:${d}` : ""
}

const isPreferredEvent = (candidate: TrustedEvent, current: TrustedEvent | undefined) => {
  if (!current) return true
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at

  return candidate.id < current.id
}

export const findAddressableEvent = (ref: AddressRef | undefined, events: TrustedEvent[]) => {
  if (!ref) return undefined

  let selected: TrustedEvent | undefined

  for (const event of events) {
    if (event.kind !== ref.kind) continue
    if (getAddress(event) !== ref.address) continue
    if (isPreferredEvent(event, selected)) selected = event
  }

  return selected
}

export const findProfileListEvent = (
  profileListRef: CommunityProfileListRef | undefined,
  profileListEvents: TrustedEvent[],
) => findAddressableEvent(profileListRef, profileListEvents)

export const getSectionProfileListPubkeys = ({
  section,
  profileListEvents,
  reportState,
}: {
  section: CommunitySection | undefined
  profileListEvents: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}) =>
  Array.from(
    new Set(
      (section?.profileLists || [])
        .flatMap(ref => getProfileListPubkeys(findProfileListEvent(ref, profileListEvents)))
        .filter(Boolean)
        .filter(pubkey => !isCommunityReportStatePersonBanned(reportState, pubkey)),
    ),
  )

export const userHasSectionProfileListAccess = ({
  section,
  profileListEvents,
  userPubkey,
  reportState,
}: {
  section: CommunitySection | undefined
  profileListEvents: TrustedEvent[]
  userPubkey: string
  reportState?: EffectiveCommunityReportState
}) =>
  getSectionProfileListPubkeys({section, profileListEvents, reportState}).includes(
    normalizePubkey(userPubkey),
  )

export const canWriteCommunitySection = ({
  definition,
  profileListEvents,
  userPubkey,
  sectionName,
  kind,
  subtype,
  reportState,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  userPubkey: string
  sectionName: string
  kind: number
  subtype?: string
  reportState?: EffectiveCommunityReportState
}) => {
  const section = findCommunitySection(definition, sectionName)
  if (!sectionSupportsKind(section, kind, subtype)) return false
  const normalizedUser = normalizePubkey(userPubkey)

  if (definition.pubkey === normalizedUser) return true
  if (isCommunityReportStatePersonBanned(reportState, normalizedUser)) return false
  if (section?.profileLists.some(ref => userCanManageProfileList(ref, normalizedUser))) return true

  return userHasSectionProfileListAccess({
    section,
    profileListEvents,
    userPubkey: normalizedUser,
    reportState,
  })
}

export const canWriteCommunityTarget = ({
  definition,
  profileListEvents,
  userPubkey,
  target,
  reportState,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  userPubkey: string
  target: CommunityWriteTarget
  reportState?: EffectiveCommunityReportState
}) => {
  const section =
    findCommunitySection(definition, target.sectionName) ||
    definition.sections.find(section => sectionSupportsKind(section, target.kind, target.subtype))

  if (!section) return false

  return canWriteCommunitySection({
    definition,
    profileListEvents,
    userPubkey,
    sectionName: section.name,
    kind: target.kind,
    subtype: target.subtype,
    reportState,
  })
}

export const getCommunityPublishCapabilityMap = ({
  definition,
  profileListEvents,
  userPubkey,
  reportState,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  userPubkey: string
  reportState?: EffectiveCommunityReportState
}) =>
  Object.fromEntries(
    (Object.values(COMMUNITY_WRITE_TARGETS) as CommunityWriteTarget[]).map(target => [
      getCommunityCapabilityKey(target.kind, target.subtype),
      {
        ...target,
        key: getCommunityCapabilityKey(target.kind, target.subtype),
        canWrite: canWriteCommunityTarget({
          definition,
          profileListEvents,
          userPubkey,
          target,
          reportState,
        }),
      } satisfies CommunityPublishCapability,
    ]),
  ) as Record<string, CommunityPublishCapability>

export const getCommunityPublishGateState = ({
  definition,
  profileListEvents,
  userPubkey,
  target,
  form,
  responseEvents = [],
  deleteEvents = [],
  reviewEvents = [],
  reportState,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  userPubkey?: string
  target: CommunityWriteTarget
  form?: CommunityAdmissionForm
  responseEvents?: TrustedEvent[]
  deleteEvents?: TrustedEvent[]
  reviewEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}): CommunityPublishGateState => {
  const normalizedUser = normalizePubkey(userPubkey || "")
  const section =
    findCommunitySection(definition, target.sectionName) ||
    definition.sections.find(section => sectionSupportsKind(section, target.kind, target.subtype))
  const resolvedTarget = {...target, sectionName: section?.name || target.sectionName}
  const base = {...resolvedTarget, form}

  if (!normalizedUser) return {...base, status: "login-required"}
  if (
    normalizedUser !== normalizePubkey(definition.pubkey) &&
    isCommunityReportStatePersonBanned(reportState, normalizedUser)
  ) {
    return {...base, status: "banned"}
  }

  if (
    canWriteCommunityTarget({
      definition,
      profileListEvents,
      userPubkey: normalizedUser,
      target,
      reportState,
    })
  ) {
    return {...base, status: "allowed"}
  }

  if (!form) return {...base, status: "missing"}

  const submission = getAdmissionSubmissionState({
    responseEvents,
    deleteEvents,
    reviewEvents,
    formAddress: form.address,
    applicantPubkey: normalizedUser,
    moderatorPubkeys: getGrantCapableSectionModeratorPubkeys({
      definition,
      sectionName: resolvedTarget.sectionName,
      reportState,
    }),
  })

  if (submission.status === "pending")
    return {...base, status: "pending", response: submission.response}
  if (submission.status === "rejected") {
    return {...base, status: "rejected", response: submission.response, review: submission.review}
  }
  if (submission.status === "granted") {
    return {...base, status: "granted", response: submission.response, review: submission.review}
  }

  return {...base, status: "missing"}
}

export const getGrantCapableSectionModeratorPubkeys = ({
  definition,
  sectionName,
  reportState,
}: {
  definition: CommunityDefinition
  sectionName: string
  reportState?: EffectiveCommunityReportState
}) => {
  const section = findCommunitySection(definition, sectionName)
  if (!section) return []

  return Array.from(
    new Set(
      section.profileLists
        .map(ref => ref.pubkey)
        .map(normalizePubkey)
        .filter(Boolean)
        .filter(pubkey => !isCommunityReportStatePersonBanned(reportState, pubkey)),
    ),
  )
}

export const getCommunitySectionAuthorityPubkeys = ({
  definition,
  sectionName,
  reportState,
}: {
  definition: CommunityDefinition
  sectionName: string
  reportState?: EffectiveCommunityReportState
}) => {
  const section = findCommunitySection(definition, sectionName)
  if (!section) return [definition.pubkey]

  return Array.from(
    new Set(
      [
        definition.pubkey,
        ...section.profileLists.map(ref => ref.pubkey),
      ]
        .map(normalizePubkey)
        .filter(Boolean),
    ),
  ).filter(
    pubkey =>
      pubkey === normalizePubkey(definition.pubkey) ||
      !isCommunityReportStatePersonBanned(reportState, pubkey),
  )
}

export const getCommunitySectionWriterPubkeys = ({
  definition,
  profileListEvents,
  sectionName,
  reportState,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  sectionName: string
  reportState?: EffectiveCommunityReportState
}) => {
  const section = findCommunitySection(definition, sectionName)
  const pubkeys = new Set(getCommunitySectionAuthorityPubkeys({definition, sectionName, reportState}))

  for (const pubkey of getSectionProfileListPubkeys({section, profileListEvents, reportState}))
    pubkeys.add(pubkey)

  return Array.from(pubkeys)
}

export const getGrantCapability = ({
  definition,
  userPubkey,
  sectionName,
  reportState,
}: {
  definition: CommunityDefinition
  userPubkey: string
  sectionName: string
  reportState?: EffectiveCommunityReportState
}): CommunityGrantCapability => {
  const section = findCommunitySection(definition, sectionName)
  const normalizedUser = normalizePubkey(userPubkey)

  if (
    normalizedUser !== normalizePubkey(definition.pubkey) &&
    isCommunityReportStatePersonBanned(reportState, normalizedUser)
  ) {
    return {canManageList: false, canGrant: false}
  }

  const profileList = section?.profileLists.find(ref =>
    userCanManageProfileList(ref, normalizedUser),
  )
  const canManageList = Boolean(profileList)

  return {
    canManageList,
    canGrant: canManageList,
    profileList,
  }
}
