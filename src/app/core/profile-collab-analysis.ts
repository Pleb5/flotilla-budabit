import {get, writable} from "svelte/store"
import {makeLoader} from "@welshman/net"
import {getTagValue, type TrustedEvent} from "@welshman/util"
import {loadProfile, pubkey} from "@welshman/app"
import {
  GIT_REPO_ANNOUNCEMENT,
  GIT_PULL_REQUEST,
  GIT_STATUS_APPLIED,
  type PullRequestEvent,
  type RepoAnnouncementEvent,
  type StatusEvent,
} from "@nostr-git/core/events"
import {
  getRepoMaintainers,
  getRepoAnnouncementRelays,
  loadRepoAnnouncementByAddress,
  repoAnnouncementsByAddress,
} from "@app/core/git-state"
import type {CommunityDefinition} from "@app/core/community"
import type {EffectiveCommunityReportState} from "@app/core/community-reports"
import {buildCommunityTrustAssessments} from "./community-trust"

export const PROFILE_CODE_TRUST_WINDOW_DAYS = 180
export const PROFILE_CODE_TRUST_PULL_REQUEST_LIMIT = 25
export const PROFILE_CODE_TRUST_STATUS_LIMIT = 25
export const PROFILE_CODE_TRUST_DETAIL_LIMIT = 5

export type ProfileCodeTrustRepoDetail = {
  repoAddress: string
  repoName: string
  count: number
}

export type ProfileCodeTrustInteractionDetail = {
  rootId: string
  repoAddress: string
  repoName: string
  subject: string
  createdAt: number
  authorPubkey: string
  mergedByPubkey?: string
}

export type ProfileCodeTrustCollaborator = {
  pubkey: string
  communityScore: number
  mergedTargetPullRequests: number
  mergedByTarget: number
  totalInteractions: number
  latestAt: number
  repoCount: number
  repoNames: string[]
  mergedTargetPullRequestDetails: ProfileCodeTrustInteractionDetail[]
  mergedByTargetDetails: ProfileCodeTrustInteractionDetail[]
  repoDetails: ProfileCodeTrustRepoDetail[]
}

export type ProfileCodeTrustAnalysis = {
  targetPubkey: string
  communityContextPubkey?: string
  communityContextAvailable: boolean
  windowDays: number
  analyzedAt: number
  relays: string[]
  authoredPullRequestCount: number
  maintainerActionCount: number
  maintainerAcceptedPullRequests: number
  communityAlignedMaintainerMerges: number
  communityCollaborators: number
  maintainerAcceptedPullRequestDetails: ProfileCodeTrustInteractionDetail[]
  communityAlignedMaintainerMergeDetails: ProfileCodeTrustInteractionDetail[]
  authoredPullRequestDetails: ProfileCodeTrustInteractionDetail[]
  maintainerActionDetails: ProfileCodeTrustInteractionDetail[]
  collaborators: ProfileCodeTrustCollaborator[]
}

type CollaborationBucket = {
  pubkey: string
  communityScore: number
  mergedTargetPullRequests: number
  mergedByTarget: number
  latestAt: number
  repos: Map<string, number>
  mergedTargetPullRequestDetails: ProfileCodeTrustInteractionDetail[]
  mergedByTargetDetails: ProfileCodeTrustInteractionDetail[]
}

type BuildProfileCodeTrustAnalysisInput = {
  targetPubkey: string
  communityAlignedScores?: Map<string, number>
  communityContextPubkey?: string
  communityContextAvailable?: boolean
  pullRequests: PullRequestEvent[]
  appliedStatuses: StatusEvent[]
  repoMaintainersByAddress: Map<string, Set<string>>
  repoNamesByAddress?: Map<string, string>
  windowDays?: number
  analyzedAt?: number
  relays?: string[]
}

export type ProfileCodeTrustCommunityContext = {
  communityPubkey?: string
  definitions?: CommunityDefinition[]
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}

const PROFILE_CODE_TRUST_CACHE_TTL = 1000 * 60 * 10
const profileCodeTrustAnalysisLoad = makeLoader({delay: 200, timeout: 6000, threshold: 0.5})

export const profileCodeTrustAnalyses = writable<Map<string, ProfileCodeTrustAnalysis>>(new Map())

const getStatusRootId = (event: Pick<StatusEvent, "tags">) =>
  event.tags.find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
  getTagValue("e", event.tags) ||
  ""

const getRepoAddress = (event: Pick<PullRequestEvent, "tags">) => getTagValue("a", event.tags) || ""

const getRepoOwner = (repoAddress: string) => repoAddress.split(":")[1] || ""

const getRepoName = (repoAddress: string, repoNamesByAddress: Map<string, string>) =>
  repoNamesByAddress.get(repoAddress) || repoAddress.split(":").slice(2).join(":") || repoAddress

const getRepoAnnouncementAddress = (repoEvent: RepoAnnouncementEvent) => {
  const identifier = getTagValue("d", repoEvent.tags || []) || ""

  return identifier ? `${repoEvent.kind}:${repoEvent.pubkey}:${identifier}` : ""
}

const getPullRequestSubject = (pullRequest: Pick<PullRequestEvent, "tags">) =>
  getTagValue("subject", pullRequest.tags) || "Pull Request"

const makeInteractionDetail = (
  pullRequest: PullRequestEvent,
  repoNamesByAddress: Map<string, string>,
  latestStatus?: StatusEvent,
): ProfileCodeTrustInteractionDetail => {
  const repoAddress = getRepoAddress(pullRequest)

  return {
    rootId: pullRequest.id,
    repoAddress,
    repoName: getRepoName(repoAddress, repoNamesByAddress),
    subject: getPullRequestSubject(pullRequest),
    createdAt: latestStatus?.created_at || pullRequest.created_at,
    authorPubkey: pullRequest.pubkey,
    mergedByPubkey: latestStatus?.pubkey,
  }
}

const takeRecentDetails = (
  details: ProfileCodeTrustInteractionDetail[],
  limit = PROFILE_CODE_TRUST_DETAIL_LIMIT,
) =>
  [...details]
    .sort((a, b) => b.createdAt - a.createdAt || a.rootId.localeCompare(b.rootId))
    .slice(0, limit)

const getLatestEventsById = <T extends TrustedEvent>(events: Iterable<T>) => {
  const latestById = new Map<string, T>()

  for (const event of events) {
    const existing = latestById.get(event.id)

    if (!existing || event.created_at > existing.created_at) {
      latestById.set(event.id, event)
    }
  }

  return latestById
}

const groupStatusesByRoot = (events: Iterable<StatusEvent>) => {
  const grouped = new Map<string, StatusEvent[]>()

  for (const event of events) {
    const rootId = getStatusRootId(event)

    if (!rootId) continue

    const statuses = grouped.get(rootId) || []

    statuses.push(event)
    grouped.set(rootId, statuses)
  }

  return grouped
}

const getRepoMaintainerSet = (
  repoAddress: string,
  repoMaintainersByAddress: Map<string, Set<string>>,
) => {
  const maintainers = new Set<string>(repoMaintainersByAddress.get(repoAddress) || [])
  const owner = getRepoOwner(repoAddress)

  if (owner) {
    maintainers.add(owner)
  }

  return maintainers
}

const getLatestMaintainerAppliedStatus = (
  pullRequest: PullRequestEvent,
  statuses: StatusEvent[],
  repoMaintainersByAddress: Map<string, Set<string>>,
) => {
  const repoAddress = getRepoAddress(pullRequest)
  const maintainers = getRepoMaintainerSet(repoAddress, repoMaintainersByAddress)

  if (maintainers.size === 0) return

  return [...statuses]
    .filter(status => maintainers.has(status.pubkey))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]
}

const addCollaboratorInteraction = (
  collaborators: Map<string, CollaborationBucket>,
  {
    collaboratorPubkey,
    communityScore,
    type,
    repoAddress,
    createdAt,
    detail,
  }: {
    collaboratorPubkey: string
    communityScore: number
    type: "merged_target_pr" | "merged_by_target"
    repoAddress: string
    createdAt: number
    detail: ProfileCodeTrustInteractionDetail
  },
) => {
  const current =
    collaborators.get(collaboratorPubkey) ||
    ({
      pubkey: collaboratorPubkey,
      communityScore,
      mergedTargetPullRequests: 0,
      mergedByTarget: 0,
      latestAt: 0,
      repos: new Map<string, number>(),
      mergedTargetPullRequestDetails: [],
      mergedByTargetDetails: [],
    } satisfies CollaborationBucket)

  current.communityScore = Math.max(current.communityScore, communityScore)
  current.latestAt = Math.max(current.latestAt, createdAt)
  current.repos.set(repoAddress, (current.repos.get(repoAddress) || 0) + 1)

  if (type === "merged_target_pr") {
    current.mergedTargetPullRequests += 1
    current.mergedTargetPullRequestDetails = takeRecentDetails([
      ...current.mergedTargetPullRequestDetails.filter(
        existing => existing.rootId !== detail.rootId,
      ),
      detail,
    ])
  } else {
    current.mergedByTarget += 1
    current.mergedByTargetDetails = takeRecentDetails([
      ...current.mergedByTargetDetails.filter(existing => existing.rootId !== detail.rootId),
      detail,
    ])
  }

  collaborators.set(collaboratorPubkey, current)
}

export const buildProfileCodeTrustAnalysis = ({
  targetPubkey,
  communityAlignedScores = new Map(),
  communityContextPubkey,
  communityContextAvailable = Boolean(communityContextPubkey),
  pullRequests,
  appliedStatuses,
  repoMaintainersByAddress,
  repoNamesByAddress = new Map(),
  windowDays = PROFILE_CODE_TRUST_WINDOW_DAYS,
  analyzedAt = Date.now(),
  relays = [],
}: BuildProfileCodeTrustAnalysisInput): ProfileCodeTrustAnalysis => {
  const pullRequestsById = getLatestEventsById(pullRequests)
  const statusesByRoot = groupStatusesByRoot(appliedStatuses)
  const collaborators = new Map<string, CollaborationBucket>()
  let maintainerAcceptedPullRequestDetails: ProfileCodeTrustInteractionDetail[] = []
  let communityAlignedMaintainerMergeDetails: ProfileCodeTrustInteractionDetail[] = []
  let maintainerActionDetails: ProfileCodeTrustInteractionDetail[] = []

  let maintainerAcceptedPullRequests = 0
  let communityAlignedMaintainerMerges = 0

  const authoredPullRequests = Array.from(pullRequestsById.values()).filter(
    pullRequest => pullRequest.pubkey === targetPubkey,
  )
  const authoredPullRequestDetails = takeRecentDetails(
    authoredPullRequests.map(pullRequest =>
      makeInteractionDetail(
        pullRequest,
        repoNamesByAddress,
        getLatestMaintainerAppliedStatus(
          pullRequest,
          statusesByRoot.get(pullRequest.id) || [],
          repoMaintainersByAddress,
        ),
      ),
    ),
  )

  for (const pullRequest of authoredPullRequests) {
    const latestStatus = getLatestMaintainerAppliedStatus(
      pullRequest,
      statusesByRoot.get(pullRequest.id) || [],
      repoMaintainersByAddress,
    )

    if (!latestStatus) continue

    const collaboratorPubkey = latestStatus.pubkey
    const communityScore = communityAlignedScores.get(collaboratorPubkey) || 0
    const detail = makeInteractionDetail(pullRequest, repoNamesByAddress, latestStatus)

    maintainerAcceptedPullRequests += 1
    maintainerAcceptedPullRequestDetails = takeRecentDetails([
      ...maintainerAcceptedPullRequestDetails.filter(existing => existing.rootId !== detail.rootId),
      detail,
    ])

    if (communityScore > 0 && collaboratorPubkey !== targetPubkey) {
      addCollaboratorInteraction(collaborators, {
        collaboratorPubkey,
        communityScore,
        type: "merged_target_pr",
        repoAddress: getRepoAddress(pullRequest),
        createdAt: latestStatus.created_at,
        detail,
      })
    }
  }

  for (const [rootId, statuses] of statusesByRoot.entries()) {
    const pullRequest = pullRequestsById.get(rootId)

    if (!pullRequest) continue

    const latestStatus = getLatestMaintainerAppliedStatus(
      pullRequest,
      statuses,
      repoMaintainersByAddress,
    )

    if (!latestStatus || latestStatus.pubkey !== targetPubkey) continue

    const detail = makeInteractionDetail(pullRequest, repoNamesByAddress, latestStatus)

    maintainerActionDetails = takeRecentDetails([
      ...maintainerActionDetails.filter(existing => existing.rootId !== detail.rootId),
      detail,
    ])

    const collaboratorPubkey = pullRequest.pubkey

    if (!collaboratorPubkey || collaboratorPubkey === targetPubkey) continue

    const communityScore = communityAlignedScores.get(collaboratorPubkey) || 0

    if (communityScore <= 0) continue

    communityAlignedMaintainerMerges += 1
    communityAlignedMaintainerMergeDetails = takeRecentDetails([
      ...communityAlignedMaintainerMergeDetails.filter(existing => existing.rootId !== detail.rootId),
      detail,
    ])
    addCollaboratorInteraction(collaborators, {
      collaboratorPubkey,
      communityScore,
      type: "merged_by_target",
      repoAddress: getRepoAddress(pullRequest),
      createdAt: latestStatus.created_at,
      detail,
    })
  }

  const collaboratorList = Array.from(collaborators.values())
    .map(collaborator => ({
      pubkey: collaborator.pubkey,
      communityScore: collaborator.communityScore,
      mergedTargetPullRequests: collaborator.mergedTargetPullRequests,
      mergedByTarget: collaborator.mergedByTarget,
      totalInteractions: collaborator.mergedTargetPullRequests + collaborator.mergedByTarget,
      latestAt: collaborator.latestAt,
      repoCount: collaborator.repos.size,
      repoNames: Array.from(collaborator.repos.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([repoAddress]) => getRepoName(repoAddress, repoNamesByAddress))
        .slice(0, 3),
      mergedTargetPullRequestDetails: collaborator.mergedTargetPullRequestDetails,
      mergedByTargetDetails: collaborator.mergedByTargetDetails,
      repoDetails: Array.from(collaborator.repos.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([repoAddress, count]) => ({
          repoAddress,
          repoName: getRepoName(repoAddress, repoNamesByAddress),
          count,
        }))
        .slice(0, PROFILE_CODE_TRUST_DETAIL_LIMIT),
    }))
    .sort((a, b) => {
      if (a.totalInteractions !== b.totalInteractions)
        return b.totalInteractions - a.totalInteractions
      if (a.communityScore !== b.communityScore) return b.communityScore - a.communityScore
      if (a.latestAt !== b.latestAt) return b.latestAt - a.latestAt
      return a.pubkey.localeCompare(b.pubkey)
    })

  const maintainerActionCount = maintainerActionDetails.length

  return {
    targetPubkey,
    communityContextPubkey,
    communityContextAvailable,
    windowDays,
    analyzedAt,
    relays,
    authoredPullRequestCount: authoredPullRequests.length,
    maintainerActionCount,
    maintainerAcceptedPullRequests,
    communityAlignedMaintainerMerges,
    communityCollaborators: collaboratorList.length,
    maintainerAcceptedPullRequestDetails,
    communityAlignedMaintainerMergeDetails,
    authoredPullRequestDetails,
    maintainerActionDetails,
    collaborators: collaboratorList,
  }
}

export const getProfileCodeTrustAnalysisKey = (
  viewerPubkey: string,
  targetPubkey: string,
  communityPubkey = "",
) => `${viewerPubkey}:${targetPubkey}:${communityPubkey || "no-community"}`

const getCachedProfileCodeTrustAnalysis = (
  viewerPubkey: string,
  targetPubkey: string,
  communityPubkey = "",
) => {
  const key = getProfileCodeTrustAnalysisKey(viewerPubkey, targetPubkey, communityPubkey)
  const cached = get(profileCodeTrustAnalyses).get(key)

  if (!cached) return

  if (cached.analyzedAt < Date.now() - PROFILE_CODE_TRUST_CACHE_TTL) {
    profileCodeTrustAnalyses.update(entries => {
      const next = new Map(entries)

      next.delete(key)

      return next
    })
    return
  }

  return cached
}

export const loadProfileCodeTrustAnalysis = async (
  targetPubkey: string,
  {
    force = false,
    communityContext,
  }: {force?: boolean; communityContext?: ProfileCodeTrustCommunityContext} = {},
) => {
  const viewerPubkey = pubkey.get() || ""
  const communityContextPubkey = communityContext?.communityPubkey || ""

  if (!viewerPubkey) {
    throw new Error("Sign in to analyze code collaboration.")
  }

  if (!force) {
    const cached = getCachedProfileCodeTrustAnalysis(
      viewerPubkey,
      targetPubkey,
      communityContextPubkey,
    )

    if (cached) {
      return cached
    }
  }

  const relays = getRepoAnnouncementRelays()

  if (relays.length === 0) {
    throw new Error("No git relays available for analysis.")
  }

  const since = Math.floor(Date.now() / 1000) - PROFILE_CODE_TRUST_WINDOW_DAYS * 24 * 60 * 60
  const initialEvents = await profileCodeTrustAnalysisLoad({
    relays,
    filters: [
      {
        kinds: [GIT_PULL_REQUEST],
        authors: [targetPubkey],
        since,
        limit: PROFILE_CODE_TRUST_PULL_REQUEST_LIMIT,
      },
      {
        kinds: [GIT_STATUS_APPLIED],
        authors: [targetPubkey],
        since,
        limit: PROFILE_CODE_TRUST_STATUS_LIMIT,
      },
    ],
  })

  const initialPullRequests = initialEvents.filter(
    event => event.kind === GIT_PULL_REQUEST,
  ) as PullRequestEvent[]
  const targetAppliedStatuses = initialEvents.filter(
    event => event.kind === GIT_STATUS_APPLIED,
  ) as StatusEvent[]
  const relatedRootIds = Array.from(
    new Set([
      ...initialPullRequests.map(pullRequest => pullRequest.id),
      ...targetAppliedStatuses.map(status => getStatusRootId(status)).filter(Boolean),
    ]),
  )

  const followUpEvents =
    relatedRootIds.length > 0
      ? await profileCodeTrustAnalysisLoad({
          relays,
          filters: [
            {kinds: [GIT_PULL_REQUEST], ids: relatedRootIds},
            {kinds: [GIT_STATUS_APPLIED], "#e": relatedRootIds, since},
          ],
        })
      : []

  const pullRequests = Array.from(
    getLatestEventsById(
      [...initialEvents, ...followUpEvents].filter(
        event => event.kind === GIT_PULL_REQUEST,
      ) as PullRequestEvent[],
    ).values(),
  )
  const appliedStatuses = Array.from(
    getLatestEventsById(
      [...initialEvents, ...followUpEvents].filter(
        event => event.kind === GIT_STATUS_APPLIED,
      ) as StatusEvent[],
    ).values(),
  )
  const candidatePubkeys = Array.from(
    new Set(
      [
        targetPubkey,
        ...pullRequests.map(pullRequest => pullRequest.pubkey),
        ...appliedStatuses.map(status => status.pubkey),
      ].filter(Boolean),
    ),
  )
  const communityAlignedScores = getProfileCommunityAlignedScores({
    viewerPubkey,
    candidatePubkeys,
    communityContext,
  })

  const repoAddresses = Array.from(
    new Set(pullRequests.map(pullRequest => getRepoAddress(pullRequest)).filter(Boolean)),
  )

  const repoLoadResults = await Promise.all(
    repoAddresses.map(async repoAddress => {
      try {
        return (await loadRepoAnnouncementByAddress(repoAddress)) || []
      } catch {
        return []
      }
    }),
  )
  const loadedRepoEvents = repoLoadResults
    .flat()
    .filter((event): event is RepoAnnouncementEvent => event?.kind === GIT_REPO_ANNOUNCEMENT)

  const repoEventsByAddress = new Map<string, RepoAnnouncementEvent>()

  for (const [address, event] of get(repoAnnouncementsByAddress)) {
    repoEventsByAddress.set(address, event)
  }

  for (const event of loadedRepoEvents) {
    const address = getRepoAnnouncementAddress(event)
    if (!address) continue

    const current = repoEventsByAddress.get(address)
    if (!current || event.created_at > current.created_at) {
      repoEventsByAddress.set(address, event)
    }
  }

  const repoEvents = repoAddresses
    .map(repoAddress => repoEventsByAddress.get(repoAddress))
    .filter(Boolean) as RepoAnnouncementEvent[]

  const repoNamesByAddress = new Map<string, string>()
  const repoMaintainersByAddress = new Map<string, Set<string>>()

  for (const repoEvent of repoEvents) {
    const repoAddress = getRepoAnnouncementAddress(repoEvent)
    const repoName =
      getTagValue("name", repoEvent.tags) || getTagValue("d", repoEvent.tags) || repoAddress

    repoNamesByAddress.set(repoAddress, repoName)
    repoMaintainersByAddress.set(repoAddress, new Set(getRepoMaintainers(repoEvent)))
  }

  const analysis = buildProfileCodeTrustAnalysis({
    targetPubkey,
    communityAlignedScores,
    communityContextPubkey,
    communityContextAvailable: Boolean(
      communityContextPubkey && communityContext?.definitions?.length,
    ),
    pullRequests,
    appliedStatuses,
    repoMaintainersByAddress,
    repoNamesByAddress,
    relays,
  })

  await Promise.all(
    analysis.collaborators.map(collaborator =>
      loadProfile(collaborator.pubkey).catch(() => undefined),
    ),
  )

  profileCodeTrustAnalyses.update(entries => {
    const next = new Map(entries)

    next.set(
      getProfileCodeTrustAnalysisKey(viewerPubkey, targetPubkey, communityContextPubkey),
      analysis,
    )

    return next
  })

  return analysis
}

const getProfileCommunityAlignedScores = ({
  viewerPubkey,
  candidatePubkeys,
  communityContext,
}: {
  viewerPubkey: string
  candidatePubkeys: string[]
  communityContext?: ProfileCodeTrustCommunityContext
}) => {
  const definitions = (communityContext?.definitions || []).filter(Boolean)
  const communityPubkey = communityContext?.communityPubkey || definitions[0]?.pubkey || ""

  if (!communityPubkey || definitions.length === 0 || candidatePubkeys.length === 0) {
    return new Map<string, number>()
  }

  const assessments = buildCommunityTrustAssessments({
    viewerPubkey,
    candidatePubkeys,
    context: {scope: "active_community", communityPubkey},
    definitions,
    profileListEvents: communityContext?.profileListEvents || [],
    reportStates: communityContext?.reportState
      ? new Map([[communityPubkey, communityContext.reportState]])
      : undefined,
  })

  return new Map(
    Array.from(assessments.entries())
      .filter(([, assessment]) => !assessment.suppressed && assessment.score > 0)
      .map(([actor, assessment]) => [actor, assessment.score]),
  )
}
