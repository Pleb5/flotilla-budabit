import type {TrustedEvent} from "@welshman/util"
import {
  BADGE_DEFINITION_KIND,
  COMMUNITY_SECTION_CALENDAR,
  COMMUNITY_SECTION_FORUM,
  COMMUNITY_SECTION_FUNDRAISERS,
  COMMUNITY_SECTION_GENERAL,
  COMMUNITY_SECTION_PERMALINKS,
  COMMUNITY_SECTION_REPOSITORIES,
  COMMUNITY_SECTION_ROOMS,
  COMMUNITY_SECTION_WIDGETS,
  COMMUNITY_SUBTYPE_FORUM,
  COMMUNITY_SUBTYPE_ROOM,
  COMMUNITY_SUBTYPE_ROOM_MESSAGE,
  PROFILE_LIST_KIND,
  type CommunityBadgeRef,
  type CommunityDefinition,
  type CommunityProfileListRef,
  type CommunitySection,
  canWriteFromProfileList,
  findCommunitySection,
  getProfileListPubkeys,
  normalizePubkey,
  sectionSupportsKind,
  userCanIssueBadge,
  userCanManageProfileList,
} from "@app/core/community"
import {GIT_PERMALINK_KIND, SMART_WIDGET_KIND} from "@app/core/community-feeds"
import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"

export type CommunityWriteTarget = {
  sectionName: string
  kind: number
  subtype?: string
}

export type CommunityGrantCapability = {
  canManageList: boolean
  canIssueBadge: boolean
  canGrant: boolean
  profileList?: CommunityProfileListRef
  badge?: CommunityBadgeRef
}

export type CommunityPublishCapability = CommunityWriteTarget & {
  key: string
  canWrite: boolean
}

export const COMMUNITY_WRITE_TARGETS = {
  roomRoot: {sectionName: COMMUNITY_SECTION_ROOMS, kind: 11, subtype: COMMUNITY_SUBTYPE_ROOM},
  roomMessage: {sectionName: COMMUNITY_SECTION_GENERAL, kind: 9, subtype: COMMUNITY_SUBTYPE_ROOM_MESSAGE},
  forumThread: {sectionName: COMMUNITY_SECTION_FORUM, kind: 11, subtype: COMMUNITY_SUBTYPE_FORUM},
  comment: {sectionName: COMMUNITY_SECTION_GENERAL, kind: 1111},
  reaction: {sectionName: COMMUNITY_SECTION_GENERAL, kind: 7},
  label: {sectionName: COMMUNITY_SECTION_GENERAL, kind: 1985},
  calendar: {sectionName: COMMUNITY_SECTION_CALENDAR, kind: 31922},
  fundraiser: {sectionName: COMMUNITY_SECTION_FUNDRAISERS, kind: 9041},
  repository: {sectionName: COMMUNITY_SECTION_REPOSITORIES, kind: GIT_REPO_ANNOUNCEMENT},
  permalink: {sectionName: COMMUNITY_SECTION_PERMALINKS, kind: GIT_PERMALINK_KIND},
  widget: {sectionName: COMMUNITY_SECTION_WIDGETS, kind: SMART_WIDGET_KIND},
} satisfies Record<string, CommunityWriteTarget>

export const getCommunityWriteTarget = (kind: number, subtype?: string): CommunityWriteTarget | undefined =>
  (Object.values(COMMUNITY_WRITE_TARGETS) as CommunityWriteTarget[]).find(
    target => target.kind === kind && (!subtype || target.subtype === subtype),
  )

export const getCommunityCapabilityKey = (kind: number, subtype?: string) =>
  subtype ? `${kind}:${subtype}` : String(kind)

export const getPrimaryProfileListRef = (section: CommunitySection | undefined) =>
  section?.profileLists[0]

export const getPrimaryBadgeRef = (section: CommunitySection | undefined) => section?.badges[0]

const getAddress = (event: TrustedEvent) => {
  const d = event.tags.find(tag => tag[0] === "d")?.[1]
  return d ? `${event.kind}:${event.pubkey}:${d}` : ""
}

export const findProfileListEvent = (
  profileListRef: CommunityProfileListRef | undefined,
  profileListEvents: TrustedEvent[],
) => {
  if (!profileListRef) return undefined

  return profileListEvents.find(
    event => event.kind === PROFILE_LIST_KIND && getAddress(event) === profileListRef.address,
  )
}

export const findBadgeDefinitionEvent = (
  badgeRef: CommunityBadgeRef | undefined,
  badgeDefinitionEvents: TrustedEvent[],
) => {
  if (!badgeRef) return undefined

  return badgeDefinitionEvents.find(
    event => event.kind === BADGE_DEFINITION_KIND && getAddress(event) === badgeRef.address,
  )
}

export const canWriteCommunitySection = ({
  definition,
  profileListEvents,
  userPubkey,
  sectionName,
  kind,
  subtype,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  userPubkey: string
  sectionName: string
  kind: number
  subtype?: string
}) => {
  const section = findCommunitySection(definition, sectionName)
  if (!sectionSupportsKind(section, kind, subtype)) return false

  const profileListRef = getPrimaryProfileListRef(section)
  if (userCanManageProfileList(profileListRef, userPubkey)) return true

  const profileList = findProfileListEvent(profileListRef, profileListEvents)

  return canWriteFromProfileList(profileList, userPubkey)
}

export const canWriteCommunityTarget = ({
  definition,
  profileListEvents,
  userPubkey,
  target,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  userPubkey: string
  target: CommunityWriteTarget
}) =>
  canWriteCommunitySection({
    definition,
    profileListEvents,
    userPubkey,
    sectionName: target.sectionName,
    kind: target.kind,
    subtype: target.subtype,
  })

export const getCommunityPublishCapabilityMap = ({
  definition,
  profileListEvents,
  userPubkey,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  userPubkey: string
}) =>
  Object.fromEntries(
    (Object.values(COMMUNITY_WRITE_TARGETS) as CommunityWriteTarget[]).map(target => [
      getCommunityCapabilityKey(target.kind, target.subtype),
      {
        ...target,
        key: getCommunityCapabilityKey(target.kind, target.subtype),
        canWrite: canWriteCommunityTarget({definition, profileListEvents, userPubkey, target}),
      } satisfies CommunityPublishCapability,
    ]),
  ) as Record<string, CommunityPublishCapability>

export const getGrantCapableSectionModeratorPubkeys = ({
  definition,
  sectionName,
}: {
  definition: CommunityDefinition
  sectionName: string
}) => {
  const section = findCommunitySection(definition, sectionName)
  if (!section) return []

  const badgeIssuers = new Set(section.badges.map(ref => ref.pubkey))

  return Array.from(
    new Set(
      section.profileLists
        .map(ref => ref.pubkey)
        .filter(pubkey => badgeIssuers.has(pubkey))
        .map(normalizePubkey)
        .filter(Boolean),
    ),
  )
}

export const getCommunitySectionWriterPubkeys = ({
  definition,
  profileListEvents,
  sectionName,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  sectionName: string
}) => {
  const section = findCommunitySection(definition, sectionName)
  const profileList = findProfileListEvent(getPrimaryProfileListRef(section), profileListEvents)

  return getProfileListPubkeys(profileList)
}

export const getGrantCapability = ({
  definition,
  userPubkey,
  sectionName,
}: {
  definition: CommunityDefinition
  userPubkey: string
  sectionName: string
}): CommunityGrantCapability => {
  const section = findCommunitySection(definition, sectionName)
  const normalizedUser = normalizePubkey(userPubkey)
  const profileList = section?.profileLists.find(ref => userCanManageProfileList(ref, normalizedUser))
  const badge = section?.badges.find(ref => userCanIssueBadge(ref, normalizedUser))
  const canManageList = Boolean(profileList)
  const canIssueBadge = Boolean(badge)

  return {
    canManageList,
    canIssueBadge,
    canGrant: canManageList && canIssueBadge,
    profileList,
    badge,
  }
}
