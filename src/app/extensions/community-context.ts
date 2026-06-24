import type {Filter, TrustedEvent} from "@welshman/util"
import {
  makeCommunityNcommunity,
  normalizePubkey,
  parseTargetedPublication,
  sectionSupportsKind,
  type CommunityDefinition,
  type CommunitySection,
} from "@app/core/community"
import {
  COMMUNITY_TARGETABLE_KINDS,
  makeCommunityExclusiveFilter,
  makeCommunityTargetingFilter,
  makeTargetedPublicationOriginalFilters,
} from "@app/core/community-feeds"
import {
  canWriteCommunitySection,
  getCommunitySectionWriterPubkeys,
} from "@app/core/community-permissions"
import {isCommunityPersonBanned, type EffectiveCommunityReportState} from "@app/core/community-reports"
import type {CommunityProfile} from "@app/core/community-state"
import type {
  CommunityEventDescriptor,
  CommunityWidgetContext,
  CommunityWriteCapability,
} from "@app/extensions/types"

export type CommunityContextRuntimeSnapshot = {
  contextSessionId: string
  contextVersion: number
}

export type ResolvedCommunityEventDescriptor = {
  descriptor: CommunityEventDescriptor
  sections: CommunitySection[]
  writerPubkeys: string[]
  writableSections: CommunitySection[]
  capability: CommunityWriteCapability
}

export type CommunityDescriptorQueryPlan = {
  descriptors: CommunityEventDescriptor[]
  targetKinds: number[]
  targetingFilter?: Filter
  originalFilters: Filter[]
}

const COMMUNITY_TARGETABLE_KIND_SET = new Set<number>(COMMUNITY_TARGETABLE_KINDS as readonly number[])

let runtimeCommunityPubkey = ""
let runtimeFingerprint = ""
let runtimeSessionCounter = 0
let runtimeSessionId = ""
let runtimeVersion = 0

const descriptorKey = (descriptor: CommunityEventDescriptor) =>
  `${descriptor.kind}:${descriptor.subtype || ""}`

const normalizeDescriptor = (descriptor: CommunityEventDescriptor): CommunityEventDescriptor => {
  const subtype = descriptor.subtype?.trim()

  return subtype ? {kind: descriptor.kind, subtype} : {kind: descriptor.kind}
}

export const normalizeCommunityEventDescriptors = (
  descriptors: CommunityEventDescriptor[],
): CommunityEventDescriptor[] => {
  const byKey = new Map<string, CommunityEventDescriptor>()

  for (const raw of descriptors) {
    if (!raw || typeof raw.kind !== "number" || !Number.isFinite(raw.kind)) continue
    const descriptor = normalizeDescriptor(raw)
    byKey.set(descriptorKey(descriptor), descriptor)
  }

  return Array.from(byKey.values())
}

const sectionFingerprint = (definition: CommunityDefinition) =>
  definition.sections.map(section => ({
    name: section.name,
    kinds: section.kinds.map(kind => normalizeDescriptor(kind)),
    profileLists: section.profileLists.map(ref => ref.address || `${ref.kind}:${ref.pubkey}:${ref.identifier}`),
    badges: section.badges.map(ref => ref.address || `${ref.kind}:${ref.pubkey}:${ref.identifier}`),
  }))

const eventFingerprint = (events: TrustedEvent[]) =>
  events
    .map(event => `${event.kind}:${event.pubkey}:${event.tags.find(tag => tag[0] === "d")?.[1] || event.id}:${event.created_at}:${event.id}`)
    .sort()

export const getCommunityContextRuntimeSnapshot = ({
  definition,
  profileListEvents,
  reportState,
  userPubkey = "",
  relays,
  relayHints = [],
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  userPubkey?: string
  relays: string[]
  relayHints?: string[]
}): CommunityContextRuntimeSnapshot => {
  const communityPubkey = normalizePubkey(definition.pubkey)
  const fingerprint = JSON.stringify({
    communityPubkey,
    definitionEvent: definition.event.id,
    sections: sectionFingerprint(definition),
    profileListEvents: eventFingerprint(profileListEvents),
    reportState: reportState || null,
    userPubkey: normalizePubkey(userPubkey),
    relays: [...relays].sort(),
    relayHints: [...relayHints].sort(),
  })

  if (!runtimeSessionId || runtimeCommunityPubkey !== communityPubkey) {
    runtimeCommunityPubkey = communityPubkey
    runtimeFingerprint = fingerprint
    runtimeVersion = 0
    runtimeSessionId = `community-context-${Date.now()}-${++runtimeSessionCounter}`
  } else if (runtimeFingerprint !== fingerprint) {
    runtimeFingerprint = fingerprint
    runtimeVersion += 1
  }

  return {contextSessionId: runtimeSessionId, contextVersion: runtimeVersion}
}

const withLimit = (filters: Filter[], limit?: number, since?: number, until?: number) =>
  filters.map(filter => ({
    ...filter,
    ...(limit && limit > 0 ? {limit} : {}),
    ...(since && since > 0 ? {since} : {}),
    ...(until && until > 0 ? {until} : {}),
  }))

const findDescriptorSections = (
  definition: CommunityDefinition,
  descriptor: CommunityEventDescriptor,
) => definition.sections.filter(section => sectionSupportsKind(section, descriptor.kind, descriptor.subtype))

const getDescriptorLabel = (descriptor: CommunityEventDescriptor) =>
  descriptor.subtype ? `${descriptor.kind}/${descriptor.subtype}` : String(descriptor.kind)

export const resolveCommunityEventDescriptors = ({
  definition,
  profileListEvents,
  reportState,
  userPubkey = "",
  descriptors,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  userPubkey?: string
  descriptors: CommunityEventDescriptor[]
}): ResolvedCommunityEventDescriptor[] => {
  const normalizedUser = normalizePubkey(userPubkey)

  return normalizeCommunityEventDescriptors(descriptors).map(descriptor => {
    const sections = findDescriptorSections(definition, descriptor)
    if (sections.length === 0) {
      throw new Error(`No active community section supports event descriptor ${getDescriptorLabel(descriptor)}`)
    }

    const writerPubkeys = Array.from(
      new Set(
        sections.flatMap(section =>
          getCommunitySectionWriterPubkeys({
            definition,
            profileListEvents,
            sectionName: section.name,
            reportState,
          }).map(normalizePubkey),
        ),
      ),
    ).filter(Boolean)
    const writableSections = normalizedUser
      ? sections.filter(section =>
          canWriteCommunitySection({
            definition,
            profileListEvents,
            userPubkey: normalizedUser,
            sectionName: section.name,
            kind: descriptor.kind,
            subtype: descriptor.subtype,
            reportState,
          }),
        )
      : []

    return {
      descriptor,
      sections,
      writerPubkeys,
      writableSections,
      capability: {
        descriptor,
        sectionNames: sections.map(section => section.name),
        writableSectionNames: writableSections.map(section => section.name),
        canWrite: writableSections.length > 0,
      },
    }
  })
}

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
  const runtime = getCommunityContextRuntimeSnapshot({
    definition,
    profileListEvents,
    reportState,
    userPubkey,
    relays,
    relayHints,
  })

  return {
    version: 1,
    ...runtime,
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
  }
}

export const makeCommunityDescriptorQueryPlan = ({
  definition,
  profileListEvents,
  reportState,
  descriptors,
  targetingEvents = [],
  limit,
  since,
  until,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  descriptors: CommunityEventDescriptor[]
  targetingEvents?: TrustedEvent[]
  limit?: number
  since?: number
  until?: number
}): CommunityDescriptorQueryPlan => {
  const resolved = resolveCommunityEventDescriptors({
    definition,
    profileListEvents,
    reportState,
    descriptors,
  })
  const targetableInfos = resolved.filter(info =>
    COMMUNITY_TARGETABLE_KIND_SET.has(info.descriptor.kind),
  )
  const directInfos = resolved.filter(info => !COMMUNITY_TARGETABLE_KIND_SET.has(info.descriptor.kind))
  const targetKinds = Array.from(new Set(targetableInfos.map(info => info.descriptor.kind)))
  const originalFilters: Filter[] = []

  if (targetingEvents.length > 0 && targetableInfos.length > 0) {
    const authorizedTargetingEvents = targetingEvents.filter(event => {
      const targeting = parseTargetedPublication(event)
      if (!targeting) return false

      return targetableInfos.some(info => {
        if (targeting.kind !== info.descriptor.kind) return false
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
      makeCommunityExclusiveFilter(definition.pubkey, [info.descriptor.kind], {
        authors: info.writerPubkeys,
      }),
    )
  }

  return {
    descriptors: resolved.map(info => info.descriptor),
    targetKinds,
    targetingFilter: targetKinds.length
      ? makeCommunityTargetingFilter(definition.pubkey, targetKinds)
      : undefined,
    originalFilters: withLimit(originalFilters, limit, since, until),
  }
}
