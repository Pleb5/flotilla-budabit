import type {Filter, TrustedEvent} from "@welshman/util"
import {
  makeCommunityNcommunity,
  normalizePubkey,
  parseTargetedPublication,
  type CommunityDefinition,
} from "@app/core/community"
import {
  COMMUNITY_TARGETABLE_KINDS,
  makeCommunityExclusiveFilter,
  makeCommunityTargetingFilter,
  makeTargetedPublicationOriginalFilters,
} from "@app/core/community-feeds"
import {
  COMMUNITY_WRITE_TARGETS,
  getCommunityTargetWriterPubkeys,
  getCommunityWritableTargetSections,
  getCommunityWriteTargetSections,
  type CommunityWriteTarget,
} from "@app/core/community-permissions"
import {isCommunityPersonBanned, type EffectiveCommunityReportState} from "@app/core/community-reports"
import type {CommunityProfile} from "@app/core/community-state"
import type {CommunityWidgetContext} from "@app/extensions/types"

export type CommunityWriteTargetId = keyof typeof COMMUNITY_WRITE_TARGETS

export type CommunityTargetQueryPlan = {
  targetIds: CommunityWriteTargetId[]
  targetKinds: number[]
  targetingFilter?: Filter
  originalFilters: Filter[]
}

type TargetInfo = {
  id: CommunityWriteTargetId
  target: CommunityWriteTarget
  writerPubkeys: string[]
}

const COMMUNITY_TARGETABLE_KIND_SET = new Set<number>(COMMUNITY_TARGETABLE_KINDS as readonly number[])

export const isCommunityWriteTargetId = (value: string): value is CommunityWriteTargetId =>
  value in COMMUNITY_WRITE_TARGETS

export const getCommunityWriteTargetById = (id: string): CommunityWriteTarget | undefined =>
  isCommunityWriteTargetId(id) ? COMMUNITY_WRITE_TARGETS[id] : undefined

export const normalizeCommunityWriteTargetIds = (targetIds: string[]) =>
  Array.from(new Set(targetIds.filter(isCommunityWriteTargetId)))

const withLimit = (filters: Filter[], limit?: number, since?: number, until?: number) =>
  filters.map(filter => ({
    ...filter,
    ...(limit && limit > 0 ? {limit} : {}),
    ...(since && since > 0 ? {since} : {}),
    ...(until && until > 0 ? {until} : {}),
  }))

const makeTargetInfos = ({
  definition,
  profileListEvents,
  reportState,
  targetIds,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  targetIds: string[]
}): TargetInfo[] =>
  normalizeCommunityWriteTargetIds(targetIds).map(id => {
    const target = COMMUNITY_WRITE_TARGETS[id]

    return {
      id,
      target,
      writerPubkeys: getCommunityTargetWriterPubkeys({
        definition,
        profileListEvents,
        target,
        reportState,
      }),
    }
  })

export const makeCommunityWidgetContext = ({
  definition,
  profile,
  profileListEvents,
  reportState,
  userPubkey = "",
  relays,
  relayHints = [],
}: {
  definition: CommunityDefinition
  profile?: CommunityProfile
  profileListEvents: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  userPubkey?: string
  relays: string[]
  relayHints?: string[]
}): CommunityWidgetContext => {
  const normalizedUser = normalizePubkey(userPubkey)
  const normalizedCommunity = normalizePubkey(definition.pubkey)
  const writeTargets: CommunityWidgetContext["writeTargets"] = {}

  for (const [id, target] of Object.entries(COMMUNITY_WRITE_TARGETS)) {
    const sections = getCommunityWriteTargetSections(definition, target)
    const writableSections = normalizedUser
      ? getCommunityWritableTargetSections({
          definition,
          profileListEvents,
          userPubkey: normalizedUser,
          target,
          reportState,
        })
      : []

    writeTargets[id] = {
      id,
      kind: target.kind,
      subtype: "subtype" in target ? target.subtype : undefined,
      sectionNames: sections.map(section => section.name),
      writableSectionNames: writableSections.map(section => section.name),
      canWrite: writableSections.length > 0,
    }
  }

  return {
    version: 1,
    pubkey: normalizedCommunity,
    ncommunity: makeCommunityNcommunity({pubkey: normalizedCommunity, relayHints}),
    relays,
    relayHints,
    blossomServers: definition.blossomServers,
    profile: profile
      ? {
          name: profile.name,
          displayName: profile.display_name,
          picture: profile.picture,
          about: profile.about,
        }
      : undefined,
    sections: definition.sections.map(section => ({
      name: section.name,
      kinds: section.kinds.map(kind => ({
        kind: kind.kind,
        ...(kind.subtype ? {subtype: kind.subtype} : {}),
      })),
    })),
    viewer: {
      pubkey: normalizedUser || undefined,
      isOwner: Boolean(normalizedUser && normalizedUser === normalizedCommunity),
      isBanned: Boolean(
        normalizedUser && isCommunityPersonBanned(reportState, normalizedUser),
      ),
    },
    writeTargets,
  }
}

export const makeCommunityTargetQueryPlan = ({
  definition,
  profileListEvents,
  reportState,
  targetIds,
  targetingEvents = [],
  limit,
  since,
  until,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  targetIds: string[]
  targetingEvents?: TrustedEvent[]
  limit?: number
  since?: number
  until?: number
}): CommunityTargetQueryPlan => {
  const targetInfos = makeTargetInfos({definition, profileListEvents, reportState, targetIds})
  const targetableInfos = targetInfos.filter(info =>
    COMMUNITY_TARGETABLE_KIND_SET.has(info.target.kind),
  )
  const directInfos = targetInfos.filter(info => !COMMUNITY_TARGETABLE_KIND_SET.has(info.target.kind))
  const targetKinds = Array.from(new Set(targetableInfos.map(info => info.target.kind)))
  const originalFilters: Filter[] = []

  if (targetingEvents.length > 0 && targetableInfos.length > 0) {
    const authorizedTargetingEvents = targetingEvents.filter(event => {
      const targeting = parseTargetedPublication(event)
      if (!targeting) return false

      return targetableInfos.some(info => {
        if (targeting.kind !== info.target.kind) return false
        const writerSet = new Set(info.writerPubkeys.map(normalizePubkey).filter(Boolean))
        if (!writerSet.has(normalizePubkey(event.pubkey))) return false

        if (targeting.ref?.type === "a") {
          const [, author] = targeting.ref.value.split(":")
          if (!writerSet.has(normalizePubkey(author || ""))) return false
        }

        return true
      })
    })
    const allowedAuthors = Array.from(
      new Set(targetableInfos.flatMap(info => info.writerPubkeys).map(normalizePubkey).filter(Boolean)),
    )

    originalFilters.push(
      ...makeTargetedPublicationOriginalFilters(authorizedTargetingEvents, allowedAuthors),
    )
  }

  for (const info of directInfos) {
    if (info.writerPubkeys.length === 0) continue

    originalFilters.push(
      makeCommunityExclusiveFilter(definition.pubkey, [info.target.kind], {
        authors: info.writerPubkeys,
      }),
    )
  }

  return {
    targetIds: targetInfos.map(info => info.id),
    targetKinds,
    targetingFilter: targetKinds.length
      ? makeCommunityTargetingFilter(definition.pubkey, targetKinds)
      : undefined,
    originalFilters: withLimit(originalFilters, limit, since, until),
  }
}
