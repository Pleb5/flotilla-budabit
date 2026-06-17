import {EVENT_DATE, EVENT_TIME, type TrustedEvent} from "@welshman/util"
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
  COMMUNITY_SECTION_REPO_CURATOR,
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
  findCommunitySectionByKind,
  getProfileListPubkeys,
  normalizeCommunitySectionName,
  normalizeCommunitySectionSubtype,
  normalizePubkey,
  sectionSupportsKind,
  userCanManageProfileList,
} from "@app/core/community"
import {
  findCommunityProfileListEvent,
  isActiveCommunityProfileListRef,
} from "@app/core/community-admin"
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

type ResolveCommunityTargetSectionParams = {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  userPubkey?: string
  target: CommunityWriteTarget
  formSectionName?: string
  reportState?: EffectiveCommunityReportState
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
  report: {sectionName: COMMUNITY_SECTION_GENERAL, kind: 1984},
  label: {sectionName: COMMUNITY_SECTION_GENERAL, kind: 1985},
  calendarDate: {sectionName: COMMUNITY_SECTION_CALENDAR, kind: EVENT_DATE},
  calendar: {sectionName: COMMUNITY_SECTION_CALENDAR, kind: EVENT_TIME},
  goal: {sectionName: COMMUNITY_SECTION_GOALS, kind: 9041},
  repository: {sectionName: COMMUNITY_SECTION_REPO_CURATOR, kind: GIT_REPO_ANNOUNCEMENT},
  permalink: {sectionName: COMMUNITY_SECTION_REPO_CURATOR, kind: GIT_PERMALINK_KIND},
  widget: {sectionName: COMMUNITY_SECTION_WIDGETS, kind: SMART_WIDGET_KIND},
} satisfies Record<string, CommunityWriteTarget>

export const COMMUNITY_CALENDAR_WRITE_TARGETS = [
  COMMUNITY_WRITE_TARGETS.calendarDate,
  COMMUNITY_WRITE_TARGETS.calendar,
] as const

export const getCommunityCalendarWriteTarget = (kind: number): CommunityWriteTarget =>
  kind === EVENT_DATE ? COMMUNITY_WRITE_TARGETS.calendarDate : COMMUNITY_WRITE_TARGETS.calendar

export const getCommunityWriteTarget = (
  kind: number,
  subtype?: string,
): CommunityWriteTarget | undefined => {
  const normalizedSubtype = normalizeCommunitySectionSubtype(subtype)

  return (Object.values(COMMUNITY_WRITE_TARGETS) as CommunityWriteTarget[]).find(
    target =>
      target.kind === kind &&
      normalizeCommunitySectionSubtype(target.subtype) === normalizedSubtype,
  )
}

export const getCommunityCapabilityKey = (kind: number, subtype?: string) => {
  const normalizedSubtype = normalizeCommunitySectionSubtype(subtype)

  return normalizedSubtype ? `${kind}:${normalizedSubtype}` : String(kind)
}

export const getCommunityWriteTargetSections = (
  definition: CommunityDefinition,
  target: CommunityWriteTarget,
): CommunitySection[] => {
  const section = findCommunitySectionByKind(definition, target.kind, target.subtype)

  return section ? [section] : []
}

export const getCommunityWriteTargetSectionNames = (
  definition: CommunityDefinition,
  target: CommunityWriteTarget,
) => getCommunityWriteTargetSections(definition, target).map(section => section.name)

export const getCommunityWriteTargetSectionName = (
  definition: CommunityDefinition | undefined,
  target: CommunityWriteTarget,
) =>
  (definition ? getCommunityWriteTargetSections(definition, target)[0]?.name : undefined) ||
  target.sectionName

export const getCommunityCalendarWriteTargetSections = (definition: CommunityDefinition) => {
  const sections = new Map<string, CommunitySection>()

  for (const target of COMMUNITY_CALENDAR_WRITE_TARGETS) {
    for (const section of getCommunityWriteTargetSections(definition, target)) {
      sections.set(normalizeCommunitySectionName(section.name), section)
    }
  }

  return Array.from(sections.values())
}

export const getCommunityCalendarWriteTargetSectionName = (
  definition: CommunityDefinition | undefined,
) =>
  (definition ? getCommunityCalendarWriteTargetSections(definition)[0]?.name : undefined) ||
  COMMUNITY_WRITE_TARGETS.calendar.sectionName

export const communityWritableSectionsSupportTarget = ({
  definition,
  writableSections,
  target,
}: {
  definition: CommunityDefinition
  writableSections: string[]
  target: CommunityWriteTarget
}) => {
  const writable = new Set(writableSections.map(normalizeCommunitySectionName).filter(Boolean))

  return getCommunityWriteTargetSections(definition, target).some(section =>
    writable.has(normalizeCommunitySectionName(section.name)),
  )
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

export const getCommunityModeratorRefPubkeys = ({
  definition,
  reportState,
}: {
  definition: CommunityDefinition
  reportState?: EffectiveCommunityReportState
}) => {
  const ownerPubkey = normalizePubkey(definition.pubkey)

  return Array.from(
    new Set(
      definition.sections
        .flatMap(section => section.profileLists)
        .map(ref => normalizePubkey(ref.pubkey))
        .filter(pubkey => pubkey && pubkey !== ownerPubkey)
        .filter(pubkey => !isCommunityReportStatePersonBanned(reportState, pubkey)),
    ),
  )
}

export const userHasCommunityModeratorRefMembership = ({
  definition,
  userPubkey,
  reportState,
}: {
  definition: CommunityDefinition
  userPubkey: string
  reportState?: EffectiveCommunityReportState
}) =>
  getCommunityModeratorRefPubkeys({definition, reportState}).includes(normalizePubkey(userPubkey))

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
) => findCommunityProfileListEvent(profileListRef, profileListEvents)

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
  definition,
  section,
  profileListEvents,
  userPubkey,
  reportState,
}: {
  definition?: CommunityDefinition
  section: CommunitySection | undefined
  profileListEvents: TrustedEvent[]
  userPubkey: string
  reportState?: EffectiveCommunityReportState
}) => {
  if (definition && userHasCommunityModeratorRefMembership({definition, userPubkey, reportState})) {
    return true
  }

  return getSectionProfileListPubkeys({section, profileListEvents, reportState}).includes(
    normalizePubkey(userPubkey),
  )
}

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
  if (
    userHasCommunityModeratorRefMembership({definition, userPubkey: normalizedUser, reportState})
  ) {
    return true
  }
  if (
    section?.profileLists.some(
      ref =>
        userCanManageProfileList(ref, normalizedUser) &&
        isActiveCommunityProfileListRef(ref, profileListEvents),
    )
  )
    return true

  return userHasSectionProfileListAccess({
    definition,
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
  const sections = getCommunityWriteTargetSections(definition, target)

  return sections.some(section =>
    canWriteCommunitySection({
      definition,
      profileListEvents,
      userPubkey,
      sectionName: section.name,
      kind: target.kind,
      subtype: target.subtype,
      reportState,
    }),
  )
}

export const canWriteCommunityCalendarTarget = ({
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
  COMMUNITY_CALENDAR_WRITE_TARGETS.some(target =>
    canWriteCommunityTarget({definition, profileListEvents, userPubkey, target, reportState}),
  )

export const getCommunityWritableTargetSections = ({
  definition,
  profileListEvents,
  userPubkey,
  target,
  reportState,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  userPubkey?: string
  target: CommunityWriteTarget
  reportState?: EffectiveCommunityReportState
}) => {
  const normalizedUser = normalizePubkey(userPubkey || "")
  if (!normalizedUser) return []

  return getCommunityWriteTargetSections(definition, target).filter(section =>
    canWriteCommunitySection({
      definition,
      profileListEvents,
      userPubkey: normalizedUser,
      sectionName: section.name,
      kind: target.kind,
      subtype: target.subtype,
      reportState,
    }),
  )
}

export const resolveCommunityTargetSection = ({
  definition,
  profileListEvents,
  userPubkey,
  target,
  formSectionName,
  reportState,
}: ResolveCommunityTargetSectionParams) => {
  const targetSections = getCommunityWriteTargetSections(definition, target)
  const writableSection = getCommunityWritableTargetSections({
    definition,
    profileListEvents,
    userPubkey,
    target,
    reportState,
  })[0]
  if (writableSection) return writableSection

  const normalizedFormSectionName = normalizeCommunitySectionName(formSectionName || "")
  if (normalizedFormSectionName) {
    const formSection = targetSections.find(
      section => normalizeCommunitySectionName(section.name) === normalizedFormSectionName,
    )
    if (formSection) return formSection
  }

  return targetSections[0]
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
    (Object.values(COMMUNITY_WRITE_TARGETS) as CommunityWriteTarget[]).map(target => {
      const section = resolveCommunityTargetSection({
        definition,
        profileListEvents,
        userPubkey,
        target,
        reportState,
      })
      const resolvedTarget = {...target, sectionName: section?.name || target.sectionName}

      return [
        getCommunityCapabilityKey(target.kind, target.subtype),
        {
          ...resolvedTarget,
          key: getCommunityCapabilityKey(target.kind, target.subtype),
          canWrite: canWriteCommunityTarget({
            definition,
            profileListEvents,
            userPubkey,
            target,
            reportState,
          }),
        } satisfies CommunityPublishCapability,
      ]
    }),
  ) as Record<string, CommunityPublishCapability>

export const getCommunityPublishGateState = ({
  definition,
  profileListEvents,
  userPubkey,
  target,
  form,
  formSectionName,
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
  formSectionName?: string
  responseEvents?: TrustedEvent[]
  deleteEvents?: TrustedEvent[]
  reviewEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}): CommunityPublishGateState => {
  const normalizedUser = normalizePubkey(userPubkey || "")
  const section = resolveCommunityTargetSection({
    definition,
    profileListEvents,
    userPubkey: normalizedUser,
    target,
    formSectionName,
    reportState,
  })
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
      profileListEvents,
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
  profileListEvents,
  reportState,
}: {
  definition: CommunityDefinition
  sectionName: string
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}) => {
  const section = findCommunitySection(definition, sectionName)
  if (!section) return []
  const ownerPubkey = normalizePubkey(definition.pubkey)

  return Array.from(
    new Set(
      [
        ownerPubkey,
        ...section.profileLists
          .filter(ref => isActiveCommunityProfileListRef(ref, profileListEvents))
          .map(ref => ref.pubkey),
      ]
        .map(normalizePubkey)
        .filter(Boolean),
    ),
  ).filter(
    pubkey => pubkey === ownerPubkey || !isCommunityReportStatePersonBanned(reportState, pubkey),
  )
}

export const getCommunitySectionAuthorityPubkeys = ({
  definition,
  sectionName,
  profileListEvents,
  reportState,
}: {
  definition: CommunityDefinition
  sectionName: string
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}) => {
  const section = findCommunitySection(definition, sectionName)
  if (!section) return [definition.pubkey]

  return Array.from(
    new Set(
      [
        definition.pubkey,
        ...section.profileLists
          .filter(ref => isActiveCommunityProfileListRef(ref, profileListEvents))
          .map(ref => ref.pubkey),
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

export const getCommunityTargetAuthorityPubkeys = ({
  definition,
  profileListEvents,
  target,
  reportState,
}: {
  definition: CommunityDefinition
  profileListEvents?: TrustedEvent[]
  target: CommunityWriteTarget
  reportState?: EffectiveCommunityReportState
}) => {
  const pubkeys = new Set<string>()

  for (const section of getCommunityWriteTargetSections(definition, target)) {
    for (const pubkey of getCommunitySectionAuthorityPubkeys({
      definition,
      sectionName: section.name,
      profileListEvents,
      reportState,
    })) {
      pubkeys.add(pubkey)
    }
  }

  return Array.from(pubkeys)
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
  const pubkeys = new Set(
    getCommunitySectionAuthorityPubkeys({
      definition,
      sectionName,
      profileListEvents,
      reportState,
    }),
  )

  for (const pubkey of getSectionProfileListPubkeys({section, profileListEvents, reportState}))
    pubkeys.add(pubkey)

  for (const pubkey of getCommunityModeratorRefPubkeys({definition, reportState}))
    pubkeys.add(pubkey)

  return Array.from(pubkeys)
}

export const getCommunityTargetWriterPubkeys = ({
  definition,
  profileListEvents,
  target,
  reportState,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  target: CommunityWriteTarget
  reportState?: EffectiveCommunityReportState
}) => {
  const pubkeys = new Set<string>()

  for (const section of getCommunityWriteTargetSections(definition, target)) {
    for (const pubkey of getCommunitySectionWriterPubkeys({
      definition,
      profileListEvents,
      sectionName: section.name,
      reportState,
    })) {
      pubkeys.add(pubkey)
    }
  }

  return Array.from(pubkeys)
}

export const getCommunityCalendarTargetWriterPubkeys = ({
  definition,
  profileListEvents,
  reportState,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}) =>
  Array.from(
    new Set(
      COMMUNITY_CALENDAR_WRITE_TARGETS.flatMap(target =>
        getCommunityTargetWriterPubkeys({definition, profileListEvents, target, reportState}),
      ),
    ),
  )

export const getGrantCapability = ({
  definition,
  userPubkey,
  sectionName,
  profileListEvents,
  reportState,
}: {
  definition: CommunityDefinition
  userPubkey: string
  sectionName: string
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}): CommunityGrantCapability => {
  const section = findCommunitySection(definition, sectionName)
  const normalizedUser = normalizePubkey(userPubkey)
  const ownerPubkey = normalizePubkey(definition.pubkey)

  if (!section || !normalizedUser) return {canManageList: false, canGrant: false}

  if (
    normalizedUser !== ownerPubkey &&
    isCommunityReportStatePersonBanned(reportState, normalizedUser)
  ) {
    return {canManageList: false, canGrant: false}
  }

  const profileList = section?.profileLists.find(
    ref =>
      userCanManageProfileList(ref, normalizedUser) &&
      isActiveCommunityProfileListRef(ref, profileListEvents),
  )
  const canManageList = Boolean(profileList)

  return {
    canManageList,
    canGrant: normalizedUser === ownerPubkey || canManageList,
    profileList,
  }
}
