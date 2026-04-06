import {get, writable} from "svelte/store"
import {makeLoader} from "@welshman/net"
import {getTagValue, type TrustedEvent} from "@welshman/util"
import {loadProfile, pubkey} from "@welshman/app"
import {
  GIT_PULL_REQUEST,
  GIT_STATUS_APPLIED,
  type PullRequestEvent,
  type RepoAnnouncementEvent,
  type StatusEvent,
} from "@nostr-git/core/events"
import {
  effectiveMaintainersByRepoAddress,
  getRepoAnnouncementRelays,
  loadRepoAnnouncementByAddress,
  loadRepoMaintainerAnnouncements,
  repoAnnouncementsByAddress,
} from "./state"
import {loadActiveTrustGraph, type ActiveTrustGraph, type TrustGraphSource} from "./trust-graph"

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
  trustScore: number
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
  graphSource: TrustGraphSource
  windowDays: number
  analyzedAt: number
  relays: string[]
  authoredPullRequestCount: number
  maintainerActionCount: number
  trustedMergedPullRequests: number
  trustedMaintainerMerges: number
  trustedCollaborators: number
  trustedMergedPullRequestDetails: ProfileCodeTrustInteractionDetail[]
  trustedMaintainerMergeDetails: ProfileCodeTrustInteractionDetail[]
  authoredPullRequestDetails: ProfileCodeTrustInteractionDetail[]
  maintainerActionDetails: ProfileCodeTrustInteractionDetail[]
  collaborators: ProfileCodeTrustCollaborator[]
}

type CollaborationBucket = {
  pubkey: string
  trustScore: number
  mergedTargetPullRequests: number
  mergedByTarget: number
  latestAt: number
  repos: Map<string, number>
  mergedTargetPullRequestDetails: ProfileCodeTrustInteractionDetail[]
  mergedByTargetDetails: ProfileCodeTrustInteractionDetail[]
}

type BuildProfileCodeTrustAnalysisInput = {
  targetPubkey: string
  trustGraph: ActiveTrustGraph
  pullRequests: PullRequestEvent[]
  appliedStatuses: StatusEvent[]
  effectiveMaintainers: Map<string, Set<string>>
  repoNamesByAddress?: Map<string, string>
  windowDays?: number
  analyzedAt?: number
  relays?: string[]
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

const getMaintainerSet = (repoAddress: string, effectiveMaintainers: Map<string, Set<string>>) => {
  const maintainers = new Set<string>(effectiveMaintainers.get(repoAddress) || [])
  const owner = getRepoOwner(repoAddress)

  if (owner) {
    maintainers.add(owner)
  }

  return maintainers
}

const getLatestMaintainerAppliedStatus = (
  pullRequest: PullRequestEvent,
  statuses: StatusEvent[],
  effectiveMaintainers: Map<string, Set<string>>,
) => {
  const repoAddress = getRepoAddress(pullRequest)
  const maintainers = getMaintainerSet(repoAddress, effectiveMaintainers)

  if (maintainers.size === 0) return

  return [...statuses]
    .filter(status => maintainers.has(status.pubkey))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]
}

const addCollaboratorInteraction = (
  collaborators: Map<string, CollaborationBucket>,
  {
    collaboratorPubkey,
    trustScore,
    type,
    repoAddress,
    createdAt,
    detail,
  }: {
    collaboratorPubkey: string
    trustScore: number
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
      trustScore,
      mergedTargetPullRequests: 0,
      mergedByTarget: 0,
      latestAt: 0,
      repos: new Map<string, number>(),
      mergedTargetPullRequestDetails: [],
      mergedByTargetDetails: [],
    } satisfies CollaborationBucket)

  current.trustScore = Math.max(current.trustScore, trustScore)
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
  trustGraph,
  pullRequests,
  appliedStatuses,
  effectiveMaintainers,
  repoNamesByAddress = new Map(),
  windowDays = PROFILE_CODE_TRUST_WINDOW_DAYS,
  analyzedAt = Date.now(),
  relays = [],
}: BuildProfileCodeTrustAnalysisInput): ProfileCodeTrustAnalysis => {
  const pullRequestsById = getLatestEventsById(pullRequests)
  const statusesByRoot = groupStatusesByRoot(appliedStatuses)
  const collaborators = new Map<string, CollaborationBucket>()
  let trustedMergedPullRequestDetails: ProfileCodeTrustInteractionDetail[] = []
  let trustedMaintainerMergeDetails: ProfileCodeTrustInteractionDetail[] = []
  let maintainerActionDetails: ProfileCodeTrustInteractionDetail[] = []

  let trustedMergedPullRequests = 0
  let trustedMaintainerMerges = 0

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
          effectiveMaintainers,
        ),
      ),
    ),
  )

  for (const pullRequest of authoredPullRequests) {
    const latestStatus = getLatestMaintainerAppliedStatus(
      pullRequest,
      statusesByRoot.get(pullRequest.id) || [],
      effectiveMaintainers,
    )

    if (!latestStatus) continue

    const collaboratorPubkey = latestStatus.pubkey
    const trustScore = trustGraph.scores.get(collaboratorPubkey) || 0

    if (trustScore <= 0) continue

    trustedMergedPullRequests += 1
    const detail = makeInteractionDetail(pullRequest, repoNamesByAddress, latestStatus)

    trustedMergedPullRequestDetails = takeRecentDetails([
      ...trustedMergedPullRequestDetails.filter(existing => existing.rootId !== detail.rootId),
      detail,
    ])

    if (collaboratorPubkey !== targetPubkey) {
      addCollaboratorInteraction(collaborators, {
        collaboratorPubkey,
        trustScore,
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
      effectiveMaintainers,
    )

    if (!latestStatus || latestStatus.pubkey !== targetPubkey) continue

    const detail = makeInteractionDetail(pullRequest, repoNamesByAddress, latestStatus)

    maintainerActionDetails = takeRecentDetails([
      ...maintainerActionDetails.filter(existing => existing.rootId !== detail.rootId),
      detail,
    ])

    const collaboratorPubkey = pullRequest.pubkey

    if (!collaboratorPubkey || collaboratorPubkey === targetPubkey) continue

    const trustScore = trustGraph.scores.get(collaboratorPubkey) || 0

    if (trustScore <= 0) continue

    trustedMaintainerMerges += 1
    trustedMaintainerMergeDetails = takeRecentDetails([
      ...trustedMaintainerMergeDetails.filter(existing => existing.rootId !== detail.rootId),
      detail,
    ])
    addCollaboratorInteraction(collaborators, {
      collaboratorPubkey,
      trustScore,
      type: "merged_by_target",
      repoAddress: getRepoAddress(pullRequest),
      createdAt: latestStatus.created_at,
      detail,
    })
  }

  const collaboratorList = Array.from(collaborators.values())
    .map(collaborator => ({
      pubkey: collaborator.pubkey,
      trustScore: collaborator.trustScore,
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
      if (a.trustScore !== b.trustScore) return b.trustScore - a.trustScore
      if (a.latestAt !== b.latestAt) return b.latestAt - a.latestAt
      return a.pubkey.localeCompare(b.pubkey)
    })

  const maintainerActionCount = maintainerActionDetails.length

  return {
    targetPubkey,
    graphSource: trustGraph.source,
    windowDays,
    analyzedAt,
    relays,
    authoredPullRequestCount: authoredPullRequests.length,
    maintainerActionCount,
    trustedMergedPullRequests,
    trustedMaintainerMerges,
    trustedCollaborators: collaboratorList.length,
    trustedMergedPullRequestDetails,
    trustedMaintainerMergeDetails,
    authoredPullRequestDetails,
    maintainerActionDetails,
    collaborators: collaboratorList,
  }
}

export const getProfileCodeTrustAnalysisKey = (viewerPubkey: string, targetPubkey: string) =>
  `${viewerPubkey}:${targetPubkey}`

const getCachedProfileCodeTrustAnalysis = (viewerPubkey: string, targetPubkey: string) => {
  const key = getProfileCodeTrustAnalysisKey(viewerPubkey, targetPubkey)
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
  {force = false}: {force?: boolean} = {},
) => {
  const viewerPubkey = pubkey.get() || ""

  if (!viewerPubkey) {
    throw new Error("Sign in to analyze code trust.")
  }

  if (!force) {
    const cached = getCachedProfileCodeTrustAnalysis(viewerPubkey, targetPubkey)

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
  const trustGraph = await loadActiveTrustGraph(
    Array.from(
      new Set(
        [
          ...pullRequests.map(pullRequest => pullRequest.pubkey),
          ...appliedStatuses.map(status => status.pubkey),
        ].filter(pubkey => pubkey && pubkey !== targetPubkey),
      ),
    ),
  )

  const repoAddresses = Array.from(
    new Set(pullRequests.map(pullRequest => getRepoAddress(pullRequest)).filter(Boolean)),
  )

  await Promise.all(
    repoAddresses.map(repoAddress =>
      loadRepoAnnouncementByAddress(repoAddress)?.catch(() => undefined),
    ),
  )

  const repoEventsByAddress = get(repoAnnouncementsByAddress)
  const repoEvents = repoAddresses
    .map(repoAddress => repoEventsByAddress.get(repoAddress))
    .filter(Boolean) as RepoAnnouncementEvent[]

  await Promise.all(
    repoEvents.map(repoEvent => loadRepoMaintainerAnnouncements(repoEvent)?.catch(() => undefined)),
  )

  const repoNamesByAddress = new Map<string, string>()

  for (const repoEvent of repoEvents) {
    const repoAddress = `${repoEvent.kind}:${repoEvent.pubkey}:${getTagValue("d", repoEvent.tags) || ""}`
    const repoName =
      getTagValue("name", repoEvent.tags) || getTagValue("d", repoEvent.tags) || repoAddress

    repoNamesByAddress.set(repoAddress, repoName)
  }

  const analysis = buildProfileCodeTrustAnalysis({
    targetPubkey,
    trustGraph,
    pullRequests,
    appliedStatuses,
    effectiveMaintainers: get(effectiveMaintainersByRepoAddress),
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

    next.set(getProfileCodeTrustAnalysisKey(viewerPubkey, targetPubkey), analysis)

    return next
  })

  return analysis
}
