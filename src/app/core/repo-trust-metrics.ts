import {derived, readable, type Readable} from "svelte/store"
import {pubkey} from "@welshman/app"
import {getTagValue} from "@welshman/util"
import {getTrustGraphSourceLabel, loadActiveTrustGraph, type ActiveTrustGraph} from "./trust-graph"
import {getRepoMaintainers, repoAnnouncementsByAddress} from "@app/core/git-state"
import {userNip85ConfiguredProviders} from "./nip85"
import {userTrustGraphConfigValues} from "./trust-graph-config"
import type {PullRequestEvent, StatusEvent} from "@nostr-git/core/events"

export const REPO_TRUST_METRICS_KEY = Symbol("repo-trust-metrics")

export type RepoTrustActorMetric = {
  pubkey: string
  trustScore: number
  authoredMergedPullRequests: number
  appliedMergedPullRequests: number
  totalInteractions: number
}

export type RepoTrustRootMetric = {
  rootId: string
  merged: boolean
  trustedAuthor: boolean
  trustedMaintainerMerge: boolean
  trustedActorCount: number
  authorScore: number
  maintainerScore: number
  mergedByPubkey?: string
}

export type RepoTrustMetrics = {
  status: "idle" | "loading" | "ready" | "error"
  graphSource: ActiveTrustGraph["source"]
  graphLabel: string
  enabledRuleCount: number
  totalPullRequests: number
  mergedPullRequests: number
  trustedMergedContributions: number
  trustedMaintainerMerges: number
  trustedCollaborators: number
  trustedAuthors: number
  trustedMaintainers: number
  maintainerTargetBranches: string[]
  byRootId: Map<string, RepoTrustRootMetric>
  topActors: RepoTrustActorMetric[]
  error?: string
}

type BuildRepoTrustMetricsInput = {
  pullRequests: PullRequestEvent[]
  appliedStatuses: StatusEvent[]
  repoMaintainersByAddress: Map<string, Set<string>>
  trustGraph: ActiveTrustGraph
}

export const defaultRepoTrustMetrics: RepoTrustMetrics = {
  status: "idle",
  graphSource: "basic_wot",
  graphLabel: getTrustGraphSourceLabel("basic_wot"),
  enabledRuleCount: 0,
  totalPullRequests: 0,
  mergedPullRequests: 0,
  trustedMergedContributions: 0,
  trustedMaintainerMerges: 0,
  trustedCollaborators: 0,
  trustedAuthors: 0,
  trustedMaintainers: 0,
  maintainerTargetBranches: [],
  byRootId: new Map(),
  topActors: [],
}

const getStatusRootId = (status: Pick<StatusEvent, "tags">) =>
  status.tags.find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
  getTagValue("e", status.tags) ||
  ""

const getPullRequestRepoAddress = (pullRequest: Pick<PullRequestEvent, "tags">) =>
  getTagValue("a", pullRequest.tags) || ""

const getPullRequestTargetBranch = (pullRequest: Pick<PullRequestEvent, "tags">) =>
  getTagValue("branch-name", pullRequest.tags) || ""

const getRepoOwner = (repoAddress: string) => repoAddress.split(":")[1] || ""

const getRepoMaintainerSet = (repoAddress: string, repoMaintainers: Map<string, Set<string>>) => {
  const maintainers = new Set<string>(repoMaintainers.get(repoAddress) || [])
  const owner = getRepoOwner(repoAddress)

  if (owner) {
    maintainers.add(owner)
  }

  return maintainers
}

const groupStatusesByRoot = (statuses: StatusEvent[]) => {
  const grouped = new Map<string, StatusEvent[]>()

  for (const status of statuses) {
    const rootId = getStatusRootId(status)

    if (!rootId) continue

    const events = grouped.get(rootId) || []

    events.push(status)
    grouped.set(rootId, events)
  }

  return grouped
}

const getLatestMaintainerAppliedStatus = (
  pullRequest: PullRequestEvent,
  statuses: StatusEvent[],
  repoMaintainersByAddress: Map<string, Set<string>>,
) => {
  const repoAddress = getPullRequestRepoAddress(pullRequest)
  const maintainers = getRepoMaintainerSet(repoAddress, repoMaintainersByAddress)

  if (maintainers.size === 0) return

  return [...statuses]
    .filter(status => maintainers.has(status.pubkey))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]
}

const addActorMetric = (
  actors: Map<string, RepoTrustActorMetric>,
  {pubkey, trustScore, role}: {pubkey: string; trustScore: number; role: "author" | "maintainer"},
) => {
  const current =
    actors.get(pubkey) ||
    ({
      pubkey,
      trustScore,
      authoredMergedPullRequests: 0,
      appliedMergedPullRequests: 0,
      totalInteractions: 0,
    } satisfies RepoTrustActorMetric)

  current.trustScore = Math.max(current.trustScore, trustScore)
  current.totalInteractions += 1

  if (role === "author") {
    current.authoredMergedPullRequests += 1
  } else {
    current.appliedMergedPullRequests += 1
  }

  actors.set(pubkey, current)
}

export const buildRepoTrustMetrics = ({
  pullRequests,
  appliedStatuses,
  repoMaintainersByAddress,
  trustGraph,
}: BuildRepoTrustMetricsInput): RepoTrustMetrics => {
  const byRootId = new Map<string, RepoTrustRootMetric>()
  const trustedAuthors = new Set<string>()
  const trustedMaintainers = new Set<string>()
  const trustedCollaborators = new Set<string>()
  const maintainerTargetBranches = new Set<string>()
  const actorMetrics = new Map<string, RepoTrustActorMetric>()
  const statusesByRoot = groupStatusesByRoot(appliedStatuses)

  let mergedPullRequests = 0
  let trustedMergedContributions = 0
  let trustedMaintainerMerges = 0

  for (const pullRequest of pullRequests) {
    const latestStatus = getLatestMaintainerAppliedStatus(
      pullRequest,
      statusesByRoot.get(pullRequest.id) || [],
      repoMaintainersByAddress,
    )
    const targetBranch = getPullRequestTargetBranch(pullRequest)
    const authorScore = trustGraph.scores.get(pullRequest.pubkey) || 0
    const maintainerScore = latestStatus ? trustGraph.scores.get(latestStatus.pubkey) || 0 : 0
    const trustedActorCount = new Set(
      [
        authorScore > 0 ? pullRequest.pubkey : "",
        maintainerScore > 0 ? latestStatus?.pubkey || "" : "",
      ].filter(Boolean),
    ).size

    if (latestStatus) {
      mergedPullRequests += 1

      if (authorScore > 0) {
        trustedMergedContributions += 1
        trustedAuthors.add(pullRequest.pubkey)
        trustedCollaborators.add(pullRequest.pubkey)
        addActorMetric(actorMetrics, {
          pubkey: pullRequest.pubkey,
          trustScore: authorScore,
          role: "author",
        })
      }

      if (maintainerScore > 0) {
        trustedMaintainerMerges += 1
        trustedMaintainers.add(latestStatus.pubkey)
        trustedCollaborators.add(latestStatus.pubkey)
        addActorMetric(actorMetrics, {
          pubkey: latestStatus.pubkey,
          trustScore: maintainerScore,
          role: "maintainer",
        })
      }

      if (targetBranch) {
        maintainerTargetBranches.add(targetBranch)
      }
    }

    byRootId.set(pullRequest.id, {
      rootId: pullRequest.id,
      merged: Boolean(latestStatus),
      trustedAuthor: authorScore > 0,
      trustedMaintainerMerge: maintainerScore > 0,
      trustedActorCount,
      authorScore,
      maintainerScore,
      mergedByPubkey: latestStatus?.pubkey,
    })
  }

  return {
    status: "ready",
    graphSource: trustGraph.source,
    graphLabel: getTrustGraphSourceLabel(trustGraph.source),
    enabledRuleCount: trustGraph.enabledRuleCount,
    totalPullRequests: pullRequests.length,
    mergedPullRequests,
    trustedMergedContributions,
    trustedMaintainerMerges,
    trustedCollaborators: trustedCollaborators.size,
    trustedAuthors: trustedAuthors.size,
    trustedMaintainers: trustedMaintainers.size,
    maintainerTargetBranches: Array.from(maintainerTargetBranches).sort((a, b) =>
      a.localeCompare(b),
    ),
    byRootId,
    topActors: Array.from(actorMetrics.values()).sort((a, b) => {
      if (a.totalInteractions !== b.totalInteractions)
        return b.totalInteractions - a.totalInteractions
      if (a.trustScore !== b.trustScore) return b.trustScore - a.trustScore
      return a.pubkey.localeCompare(b.pubkey)
    }),
  }
}

export const createRepoTrustMetricsStore = ({
  repoAddresses,
  pullRequests,
  appliedStatuses,
}: {
  repoAddresses: Readable<string[]>
  pullRequests: Readable<PullRequestEvent[]>
  appliedStatuses: Readable<StatusEvent[]>
}) =>
  readable<RepoTrustMetrics>(defaultRepoTrustMetrics, set => {
    let requestId = 0
    let previousKey = ""
    let lastReady = defaultRepoTrustMetrics

    const combined = derived(
      [
        repoAddresses,
        pullRequests,
        appliedStatuses,
        repoAnnouncementsByAddress,
        userTrustGraphConfigValues,
        userNip85ConfiguredProviders,
        pubkey,
      ],
      ([
        $repoAddresses,
        $pullRequests,
        $appliedStatuses,
        $repoAnnouncementsByAddress,
        $graphConfig,
        $providers,
        $viewerPubkey,
      ]) => ({
        repoAddresses: $repoAddresses,
        pullRequests: $pullRequests,
        appliedStatuses: $appliedStatuses,
        repoMaintainersByAddress: new Map(
          Array.from($repoAnnouncementsByAddress.entries()).map(([address, event]) => [
            address,
            new Set(getRepoMaintainers(event)),
          ]),
        ),
        graphConfig: $graphConfig,
        providers: $providers,
        viewerPubkey: $viewerPubkey,
      }),
    )

    return combined.subscribe(
      ({
        repoAddresses,
        pullRequests,
        appliedStatuses,
        repoMaintainersByAddress,
        graphConfig,
        providers,
        viewerPubkey,
      }) => {
        const relevantRepoAddresses = Array.from(new Set(repoAddresses.filter(Boolean))).sort()
        const relevantPullRequests = pullRequests.filter(pullRequest =>
          relevantRepoAddresses.includes(getPullRequestRepoAddress(pullRequest)),
        )
        const relevantPullRequestIds = new Set(
          relevantPullRequests.map(pullRequest => pullRequest.id),
        )
        const relevantAppliedStatuses = appliedStatuses.filter(status =>
          relevantPullRequestIds.has(getStatusRootId(status)),
        )
        const candidatePubkeys = Array.from(
          new Set(
            [
              ...relevantPullRequests.map(pullRequest => pullRequest.pubkey),
              ...relevantAppliedStatuses.map(status => status.pubkey),
            ].filter(Boolean),
          ),
        ).sort()
        const key = [
          viewerPubkey || "",
          relevantRepoAddresses.join(","),
          relevantPullRequests
            .map(pullRequest => `${pullRequest.id}:${pullRequest.created_at}`)
            .sort()
            .join(","),
          relevantAppliedStatuses
            .map(status => `${status.id}:${status.created_at}`)
            .sort()
            .join(","),
          JSON.stringify(graphConfig),
          providers
            .map(provider => `${provider.serviceKey}:${provider.kindTag}:${provider.visibility}`)
            .sort()
            .join(","),
        ].join("|")

        if (key === previousKey) {
          return
        }

        previousKey = key
        const currentRequest = ++requestId

        if (!viewerPubkey) {
          lastReady = {...defaultRepoTrustMetrics, status: "ready"}
          set(lastReady)
          return
        }

        if (relevantPullRequests.length === 0) {
          lastReady = {
            ...defaultRepoTrustMetrics,
            status: "ready",
          }
          set(lastReady)
          return
        }

        set({...lastReady, status: "loading"})

        void loadActiveTrustGraph(candidatePubkeys)
          .then(trustGraph => {
            if (currentRequest !== requestId) return

            lastReady = buildRepoTrustMetrics({
            pullRequests: relevantPullRequests,
            appliedStatuses: relevantAppliedStatuses,
            repoMaintainersByAddress,
            trustGraph,
          })
            set(lastReady)
          })
          .catch(error => {
            if (currentRequest !== requestId) return

            set({
              ...lastReady,
              status: "error",
              error: error instanceof Error ? error.message : "Unable to compute trust metrics.",
            })
          })
      },
    )
  })
