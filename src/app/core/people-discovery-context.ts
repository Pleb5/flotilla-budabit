import type {RepoAnnouncementEvent} from "@nostr-git/core/events"
import type {TrustedEvent} from "@welshman/util"
import {normalizePubkey, type CommunityDefinition} from "@app/core/community"
import type {EffectiveCommunityReportState} from "@app/core/community-reports"
import {getRepoDeclaredMaintainers} from "@app/core/repo-authority"
import {
  getPrimaryRepoCommunityContext,
  getRepoAddress,
  isEndorsedRepoCommunityContext,
} from "@app/core/repo-community-context"
import type {TrustContext} from "@app/core/trust-assessment"

export type CommunityPeopleDiscoveryContext = {
  scope: "community"
  communityPubkey: string
}

export type RepoAuthorityContext =
  | {
      source: "announcement"
      event: RepoAnnouncementEvent
    }
  | {
      source: "draft"
      ownerPubkey: string
      maintainerPubkeys?: string[]
    }

export type RepoPeopleDiscoveryContext = {
  scope: "repo"
  repoAddress?: string
  authority: RepoAuthorityContext
  community?: CommunityPeopleDiscoveryContext
  associationEvents?: TrustedEvent[]
}

export type PeopleDiscoveryContext =
  | {scope: "global_discovery"}
  | CommunityPeopleDiscoveryContext
  | RepoPeopleDiscoveryContext

export type PeopleDiscoveryContextEvidence = {
  definitions: CommunityDefinition[]
  profileListEvents: TrustedEvent[]
  reportStates: Map<string, EffectiveCommunityReportState>
}

export type ResolvedPeopleDiscoveryContext = {
  trustContext: TrustContext
  communityPubkey: string
  repoOwnerPubkeys: string[]
  repoMaintainerPubkeys: string[]
}

const normalizePubkeys = (pubkeys: string[]) =>
  Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean)))

export const resolveCommunityPeopleDiscoveryContext = (
  context: CommunityPeopleDiscoveryContext,
  viewerPubkey = "",
): ResolvedPeopleDiscoveryContext => {
  const communityPubkey = normalizePubkey(context.communityPubkey)
  const normalizedViewer = normalizePubkey(viewerPubkey)

  return {
    trustContext: {
      scope: "community",
      viewerPubkey: normalizedViewer || undefined,
      communityPubkey: communityPubkey || undefined,
    },
    communityPubkey,
    repoOwnerPubkeys: [],
    repoMaintainerPubkeys: [],
  }
}

export const resolveRepoPeopleDiscoveryContext = (
  context: RepoPeopleDiscoveryContext,
  evidence: PeopleDiscoveryContextEvidence,
  viewerPubkey = "",
): ResolvedPeopleDiscoveryContext => {
  const normalizedViewer = normalizePubkey(viewerPubkey)
  const announcement = context.authority.source === "announcement" ? context.authority.event : null
  const repoOwnerPubkeys = normalizePubkeys([
    context.authority.source === "announcement"
      ? context.authority.event.pubkey
      : context.authority.ownerPubkey,
  ])
  const repoMaintainerPubkeys = normalizePubkeys(
    context.authority.source === "announcement"
      ? getRepoDeclaredMaintainers(context.authority.event)
      : context.authority.maintainerPubkeys || [],
  ).filter(maintainer => !repoOwnerPubkeys.includes(maintainer))
  const repoAddress =
    context.repoAddress || (announcement ? getRepoAddress(announcement as TrustedEvent) : "")
  let communityPubkey = normalizePubkey(context.community?.communityPubkey || "")

  if (!communityPubkey && announcement) {
    const repoCommunityContext = getPrimaryRepoCommunityContext({
      repoEvent: announcement as TrustedEvent,
      repoAddress,
      associationEvents: context.associationEvents,
      definitions: evidence.definitions,
      profileListEvents: evidence.profileListEvents,
      reportStates: evidence.reportStates,
    })

    if (isEndorsedRepoCommunityContext(repoCommunityContext)) {
      communityPubkey = normalizePubkey(repoCommunityContext?.communityPubkey || "")
    }
  }

  return {
    trustContext: {
      scope: "repo",
      viewerPubkey: normalizedViewer || undefined,
      repoAddress: repoAddress || undefined,
      communityPubkey: communityPubkey || undefined,
    },
    communityPubkey,
    repoOwnerPubkeys,
    repoMaintainerPubkeys,
  }
}

export const resolvePeopleDiscoveryContext = (
  context: PeopleDiscoveryContext | undefined,
  evidence: PeopleDiscoveryContextEvidence,
  viewerPubkey = "",
): ResolvedPeopleDiscoveryContext => {
  const normalizedViewer = normalizePubkey(viewerPubkey)

  if (!context || context.scope === "global_discovery") {
    return {
      trustContext: {scope: "global_discovery", viewerPubkey: normalizedViewer || undefined},
      communityPubkey: "",
      repoOwnerPubkeys: [],
      repoMaintainerPubkeys: [],
    }
  }

  return context.scope === "community"
    ? resolveCommunityPeopleDiscoveryContext(context, normalizedViewer)
    : resolveRepoPeopleDiscoveryContext(context, evidence, normalizedViewer)
}
