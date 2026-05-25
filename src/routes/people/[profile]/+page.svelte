<script lang="ts">
  import {onMount} from "svelte"
  import * as nip19 from "nostr-tools/nip19"
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {formatTimestampRelative} from "@welshman/lib"
  import {
    Address,
    COMMENT,
    MESSAGE,
    THREAD,
    getTagValue,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {loadProfile, profilesByPubkey, pubkey as sessionPubkey, repository} from "@welshman/app"
  import {
    GIT_COMMENT,
    GIT_ISSUE,
    GIT_PULL_REQUEST,
    GIT_REPO_ANNOUNCEMENT,
    GIT_STATUS_APPLIED,
    type IssueEvent,
    type PullRequestEvent,
    type RepoAnnouncementEvent,
    type StatusEvent,
  } from "@nostr-git/core/events"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Code2 from "@assets/icons/code-2.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import Letter from "@assets/icons/letter-opened.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import ShieldCheck from "@assets/icons/shield-check.svg?dataurl"
  import UserCircle from "@assets/icons/user-circle.svg?dataurl"
  import UsersGroup from "@assets/icons/users-group-rounded.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileInfo from "@app/components/ProfileInfo.svelte"
  import ProfileBadges from "@app/components/ProfileBadges.svelte"
  import ProfileCodeTrustAnalysis from "@app/components/ProfileCodeTrustAnalysis.svelte"
  import ProfileNip85Metrics from "@app/components/ProfileNip85Metrics.svelte"
  import {activeUserCommunityRefs, COMMUNITY_DISCOVERY_RELAYS} from "@app/core/community-state"
  import {COMMUNITY_DEFINITION_KIND, PROFILE_LIST_KIND} from "@app/core/community"
  import {selectUserCommunityRefs} from "@app/core/community-membership"
  import {makeCommunityDefinitionProfileListRefFilters} from "@app/util/community-preferences"
  import {
    getRepoAnnouncementRelays,
    getRepoMaintainers,
    loadRepoAnnouncements,
    repoAnnouncements,
  } from "@app/core/git-state"
  import {formatShortNpub, normalizePubkey} from "@app/util/pubkeys"
  import {makeRepoHrefFromEvent} from "@app/util/repo-links"
  import {makeChatPath, makeCommunityPath} from "@app/util/routes"

  type ParsedProfileRoute = {
    pubkey: string
    relays: string[]
  }

  type ProfileStat = {
    label: string
    value: number | string
    description: string
  }

  type RecentAction = {
    id: string
    kind: "repo" | "pr" | "issue" | "status" | "community" | "comment" | "snippet"
    label: string
    title: string
    context: string
    createdAt: number
    href: string
  }

  type ConnectionRow = {
    label: string
    value: number | string
    description: string
    href?: string
  }

  const RECENT_SINCE_SECONDS = Math.floor(Date.now() / 1000) - 180 * 24 * 60 * 60
  const PROFILE_EVENT_LIMIT = 200
  const COMMUNITY_ACTIVITY_LIMIT = 80
  const GIT_ACTIVITY_LIMIT = 120
  const RECENT_ACTION_PREVIEW_LIMIT = 8

  const parseProfileRouteParam = (value: string): ParsedProfileRoute | null => {
    const decoded = decodeURIComponent(value || "")
    const direct = normalizePubkey(decoded)

    if (direct) return {pubkey: direct, relays: []}

    try {
      const parsed = nip19.decode(decoded)

      if (parsed.type === "npub" && typeof parsed.data === "string") {
        return {pubkey: parsed.data, relays: []}
      }

      if (parsed.type === "nprofile" && typeof parsed.data?.pubkey === "string") {
        return {
          pubkey: parsed.data.pubkey,
          relays: Array.isArray(parsed.data.relays) ? parsed.data.relays : [],
        }
      }
    } catch {
      return null
    }

    return null
  }

  const getRepoAddress = (event: RepoAnnouncementEvent) => {
    try {
      return Address.fromEvent(event).toString()
    } catch {
      const identifier = getTagValue("d", event.tags || [])
      return identifier ? `${GIT_REPO_ANNOUNCEMENT}:${event.pubkey}:${identifier}` : ""
    }
  }

  const getRepoName = (event?: RepoAnnouncementEvent | null) =>
    event
      ? getTagValue("name", event.tags || []) || getTagValue("d", event.tags || []) || "Repository"
      : "Repository"

  const getRepoHref = (event?: RepoAnnouncementEvent | null) => {
    if (!event) return ""

    return makeRepoHrefFromEvent(event, {fallbackRelays: profileRelayHints, gitRelays})
  }

  const getRepoAddressFromRoot = (event: PullRequestEvent | IssueEvent) =>
    getTagValue("a", event.tags || []) || ""

  const getRootSubject = (event: PullRequestEvent | IssueEvent) =>
    getTagValue("subject", event.tags || []) ||
    (event.kind === GIT_PULL_REQUEST ? "Pull Request" : "Issue")

  const getStatusRootId = (event: StatusEvent) =>
    event.tags.find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
    getTagValue("e", event.tags || []) ||
    ""

  const getGitCommentRepoAddress = (event: Pick<TrustedEvent, "tags">) =>
    getTagValue("A", event.tags || []) ||
    getTagValue("a", event.tags || []) ||
    getTagValue("q", event.tags || []) ||
    getTagValue("repo", event.tags || []) ||
    ""

  const getGitCommentRootId = (event: Pick<TrustedEvent, "tags">) =>
    getTagValue("E", event.tags || []) || getTagValue("e", event.tags || []) || ""

  const getGitCommentRootKind = (event: Pick<TrustedEvent, "tags">) => {
    const value = getTagValue("K", event.tags || []) || getTagValue("k", event.tags || [])
    const kind = Number.parseInt(value || "", 10)

    return Number.isNaN(kind) ? null : kind
  }

  const getGitCommentFilePath = (event: Pick<TrustedEvent, "tags">) =>
    getTagValue("file", event.tags || []) ||
    getTagValue("path", event.tags || []) ||
    getTagValue("f", event.tags || []) ||
    ""

  const getGitCommentLineLabel = (event: Pick<TrustedEvent, "tags">) => {
    const lineTag = event.tags?.find((tag: string[]) => tag[0] === "lines" || tag[0] === "line")
    const value = lineTag?.[1] || ""

    return value ? `:${value}` : ""
  }

  const uniq = <T,>(values: T[]) => Array.from(new Set(values.filter(Boolean))) as T[]

  const getLatestById = <T extends {id: string; created_at: number}>(events: T[]) => {
    const latest = new Map<string, T>()

    for (const event of events) {
      const current = latest.get(event.id)
      if (!current || event.created_at > current.created_at) latest.set(event.id, event)
    }

    return Array.from(latest.values())
  }

  const getLatestByRepoAddress = (events: RepoAnnouncementEvent[]) => {
    const latest = new Map<string, RepoAnnouncementEvent>()

    for (const event of events) {
      const address = getRepoAddress(event)
      if (!address) continue

      const current = latest.get(address)
      if (!current || event.created_at > current.created_at) latest.set(address, event)
    }

    return latest
  }

  const formatCount = (count: number, singular: string, plural = `${singular}s`) =>
    `${count} ${count === 1 ? singular : plural}`

  const parsedProfile = $derived.by(() => parseProfileRouteParam($page.params.profile || ""))
  const targetPubkey = $derived(parsedProfile?.pubkey || "")
  const profileRelayHints = $derived(parsedProfile?.relays || [])
  const profile = $derived(targetPubkey ? $profilesByPubkey.get(targetPubkey) || null : null)
  const profileLabel = $derived(
    profile?.display_name || profile?.name || formatShortNpub(targetPubkey) || "Profile",
  )
  const isSelf = $derived(Boolean(targetPubkey && $sessionPubkey === targetPubkey))
  const canShowRelativeAnalysis = $derived(Boolean(targetPubkey && $sessionPubkey && !isSelf))
  const chatPath = $derived(targetPubkey ? makeChatPath(targetPubkey) : "")

  const communityRelays = $derived(uniq([...profileRelayHints, ...COMMUNITY_DISCOVERY_RELAYS]))
  const gitRelays = $derived(getRepoAnnouncementRelays(profileRelayHints))

  const targetCommunityProfileListFilters = $derived<Filter[]>(
    targetPubkey
      ? [
          {kinds: [PROFILE_LIST_KIND], authors: [targetPubkey], limit: PROFILE_EVENT_LIMIT},
          {kinds: [PROFILE_LIST_KIND], "#p": [targetPubkey], limit: PROFILE_EVENT_LIMIT} as Filter,
        ]
      : [],
  )
  const targetCommunityProfileListEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetCommunityProfileListFilters})),
  )
  const targetCommunityDefinitionFilters = $derived<Filter[]>([
    ...(targetPubkey
      ? [{kinds: [COMMUNITY_DEFINITION_KIND], authors: [targetPubkey], limit: PROFILE_EVENT_LIMIT}]
      : []),
    ...makeCommunityDefinitionProfileListRefFilters($targetCommunityProfileListEvents),
  ])
  const targetCommunityDefinitionEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetCommunityDefinitionFilters})),
  )
  const targetCommunityRefs = $derived.by(() =>
    selectUserCommunityRefs({
      author: targetPubkey,
      definitionEvents: $targetCommunityDefinitionEvents,
      profileListEvents: $targetCommunityProfileListEvents,
    }),
  )
  const targetCommunityPubkeys = $derived(targetCommunityRefs.map(ref => ref.communityPubkey))
  const commonCommunities = $derived.by(() => {
    if (!canShowRelativeAnalysis) return []

    const viewerByCommunity = new Map(
      $activeUserCommunityRefs.map(ref => [ref.communityPubkey, ref] as const),
    )

    return targetCommunityRefs
      .filter(ref => viewerByCommunity.has(ref.communityPubkey))
      .map(ref => ({target: ref, viewer: viewerByCommunity.get(ref.communityPubkey)!}))
  })

  const communityActivityFilters = $derived<Filter[]>(
    targetPubkey
      ? [
          {
            kinds: [THREAD, MESSAGE, COMMENT],
            authors: [targetPubkey],
            since: RECENT_SINCE_SECONDS,
            limit: COMMUNITY_ACTIVITY_LIMIT,
            ...(targetCommunityPubkeys.length ? {"#h": targetCommunityPubkeys} : {}),
          } as Filter,
        ]
      : [],
  )
  const communityActivityEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: communityActivityFilters})),
  )

  const latestRepoEventsByAddress = $derived(
    getLatestByRepoAddress($repoAnnouncements as RepoAnnouncementEvent[]),
  )
  const repoEvents = $derived(Array.from(latestRepoEventsByAddress.values()))
  const targetOwnedRepos = $derived(
    repoEvents
      .filter(event => event.pubkey === targetPubkey)
      .sort((a, b) => b.created_at - a.created_at),
  )
  const targetOwnedRepoAddresses = $derived(targetOwnedRepos.map(getRepoAddress).filter(Boolean))
  const targetMaintainedRepos = $derived(
    repoEvents
      .filter(
        event => event.pubkey !== targetPubkey && getRepoMaintainers(event).includes(targetPubkey),
      )
      .sort((a, b) => getRepoName(a).localeCompare(getRepoName(b))),
  )
  const viewerOwnedRepos = $derived(
    $sessionPubkey ? repoEvents.filter(event => event.pubkey === $sessionPubkey) : [],
  )
  const viewerOwnedRepoAddresses = $derived(viewerOwnedRepos.map(getRepoAddress).filter(Boolean))
  const viewerMaintainedRepos = $derived(
    $sessionPubkey
      ? repoEvents.filter(event => getRepoMaintainers(event).includes($sessionPubkey!))
      : [],
  )
  const viewerMaintainedRepoAddresses = $derived(
    viewerMaintainedRepos.map(getRepoAddress).filter(Boolean),
  )

  const publicGitFilters = $derived<Filter[]>(
    targetPubkey
      ? [
          {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [targetPubkey], limit: PROFILE_EVENT_LIMIT},
          {
            kinds: [GIT_PULL_REQUEST],
            authors: [targetPubkey],
            since: RECENT_SINCE_SECONDS,
            limit: GIT_ACTIVITY_LIMIT,
          },
          {
            kinds: [GIT_ISSUE],
            authors: [targetPubkey],
            since: RECENT_SINCE_SECONDS,
            limit: GIT_ACTIVITY_LIMIT,
          },
          {
            kinds: [GIT_STATUS_APPLIED],
            authors: [targetPubkey],
            since: RECENT_SINCE_SECONDS,
            limit: GIT_ACTIVITY_LIMIT,
          },
          {
            kinds: [GIT_COMMENT],
            authors: [targetPubkey],
            since: RECENT_SINCE_SECONDS,
            limit: GIT_ACTIVITY_LIMIT,
          },
        ]
      : [],
  )
  const relativeGitFilters = $derived<Filter[]>([
    ...(canShowRelativeAnalysis && viewerOwnedRepoAddresses.length
      ? [
          {
            kinds: [GIT_PULL_REQUEST],
            "#a": viewerOwnedRepoAddresses,
            since: RECENT_SINCE_SECONDS,
            limit: GIT_ACTIVITY_LIMIT,
          } as Filter,
        ]
      : []),
    ...(canShowRelativeAnalysis && targetOwnedRepoAddresses.length && $sessionPubkey
      ? [
          {
            kinds: [GIT_PULL_REQUEST],
            authors: [$sessionPubkey],
            "#a": targetOwnedRepoAddresses,
            since: RECENT_SINCE_SECONDS,
            limit: GIT_ACTIVITY_LIMIT,
          } as Filter,
        ]
      : []),
    ...(canShowRelativeAnalysis && $sessionPubkey
      ? [
          {
            kinds: [GIT_PULL_REQUEST],
            authors: [$sessionPubkey],
            since: RECENT_SINCE_SECONDS,
            limit: GIT_ACTIVITY_LIMIT,
          } as Filter,
        ]
      : []),
  ])
  const gitRootEvents = $derived(
    deriveEventsAsc(
      deriveEventsById({repository, filters: [...publicGitFilters, ...relativeGitFilters]}),
    ),
  )
  const pullRequests = $derived.by(() =>
    getLatestById(
      ($gitRootEvents.filter(event => event.kind === GIT_PULL_REQUEST) as PullRequestEvent[]) || [],
    ),
  )
  const issues = $derived.by(() =>
    getLatestById(($gitRootEvents.filter(event => event.kind === GIT_ISSUE) as IssueEvent[]) || []),
  )
  const publicStatusEvents = $derived.by(() =>
    getLatestById(
      ($gitRootEvents.filter(event => event.kind === GIT_STATUS_APPLIED) as StatusEvent[]) || [],
    ),
  )
  const statusRootIds = $derived(
    uniq([...pullRequests.map(event => event.id), ...publicStatusEvents.map(getStatusRootId)]),
  )
  const statusContextFilters = $derived<Filter[]>(
    statusRootIds.length
      ? [
          {
            kinds: [GIT_STATUS_APPLIED],
            "#e": statusRootIds,
            since: RECENT_SINCE_SECONDS,
            limit: GIT_ACTIVITY_LIMIT,
          } as Filter,
        ]
      : [],
  )
  const statusContextEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: statusContextFilters})),
  )
  const statusEvents = $derived.by(() =>
    getLatestById([
      ...publicStatusEvents,
      ...($statusContextEvents.filter(event => event.kind === GIT_STATUS_APPLIED) as StatusEvent[]),
    ]),
  )
  const pullRequestsById = $derived(new Map(pullRequests.map(event => [event.id, event] as const)))
  const targetAuthoredPullRequests = $derived(
    pullRequests
      .filter(event => event.pubkey === targetPubkey)
      .sort((a, b) => b.created_at - a.created_at),
  )
  const viewerAuthoredPullRequests = $derived(
    $sessionPubkey
      ? pullRequests
          .filter(event => event.pubkey === $sessionPubkey)
          .sort((a, b) => b.created_at - a.created_at)
      : [],
  )
  const targetAppliedStatuses = $derived(
    statusEvents
      .filter(event => event.pubkey === targetPubkey)
      .sort((a, b) => b.created_at - a.created_at),
  )
  const targetIssues = $derived(
    issues
      .filter(event => event.pubkey === targetPubkey)
      .sort((a, b) => b.created_at - a.created_at),
  )
  const targetGitComments = $derived(
    (
      $gitRootEvents.filter(
        event => event.kind === GIT_COMMENT && event.pubkey === targetPubkey,
      ) as TrustedEvent[]
    )
      .slice()
      .sort((a, b) => b.created_at - a.created_at),
  )

  const targetMaintainsViewerRepos = $derived(
    canShowRelativeAnalysis
      ? viewerOwnedRepos.filter(event =>
          getRepoMaintainers(event)
            .filter(maintainer => maintainer !== $sessionPubkey)
            .includes(targetPubkey),
        )
      : [],
  )
  const targetContributedToViewerRepos = $derived.by(() => {
    if (!canShowRelativeAnalysis) return []
    const viewerRepoSet = new Set(viewerOwnedRepoAddresses)

    return targetAuthoredPullRequests.filter(event =>
      viewerRepoSet.has(getRepoAddressFromRoot(event)),
    )
  })
  const targetMergedViewerRepoPullRequests = $derived.by(() => {
    if (!canShowRelativeAnalysis) return []
    const viewerRepoSet = new Set(viewerOwnedRepoAddresses)

    return targetAppliedStatuses.filter(status => {
      const pullRequest = pullRequestsById.get(getStatusRootId(status))
      return pullRequest ? viewerRepoSet.has(getRepoAddressFromRoot(pullRequest)) : false
    })
  })
  const viewerContributedToTargetRepos = $derived.by(() => {
    if (!canShowRelativeAnalysis) return []
    const targetRepoSet = new Set(targetOwnedRepoAddresses)

    return viewerAuthoredPullRequests.filter(event =>
      targetRepoSet.has(getRepoAddressFromRoot(event)),
    )
  })
  const sharedThirdPartyRepoAddresses = $derived.by(() => {
    if (!canShowRelativeAnalysis) return []

    const targetTouched = new Set([
      ...targetAuthoredPullRequests.map(getRepoAddressFromRoot),
      ...targetMaintainedRepos.map(getRepoAddress),
    ])
    const viewerTouched = new Set([
      ...viewerAuthoredPullRequests.map(getRepoAddressFromRoot),
      ...viewerMaintainedRepoAddresses,
    ])
    const excluded = new Set([...viewerOwnedRepoAddresses, ...targetOwnedRepoAddresses])

    return Array.from(targetTouched).filter(
      address => address && viewerTouched.has(address) && !excluded.has(address),
    )
  })
  const connectionRows = $derived<ConnectionRow[]>([
    {
      label: "Common communities",
      value: commonCommunities.length,
      description: commonCommunities.length
        ? "You both have membership or moderator context in these communities."
        : "No shared community membership loaded yet.",
    },
    {
      label: "Maintains your repos",
      value: targetMaintainsViewerRepos.length,
      description: targetMaintainsViewerRepos.length
        ? "This profile is declared as a maintainer on repositories you own."
        : "No maintainer relationship to your repos loaded yet.",
      href: targetMaintainsViewerRepos[0] ? getRepoHref(targetMaintainsViewerRepos[0]) : undefined,
    },
    {
      label: "Contributed to your repos",
      value: targetContributedToViewerRepos.length,
      description: targetContributedToViewerRepos.length
        ? "Recent pull requests by this profile target repositories you own."
        : "No recent PRs from them to your repos loaded yet.",
    },
    {
      label: "Merged work on your repos",
      value: targetMergedViewerRepoPullRequests.length,
      description: targetMergedViewerRepoPullRequests.length
        ? "This profile recently applied merge status on pull requests in your repositories."
        : "No recent merge/status actions by them on your repos loaded yet.",
    },
    {
      label: "You contributed to their repos",
      value: viewerContributedToTargetRepos.length,
      description: viewerContributedToTargetRepos.length
        ? "Recent pull requests by you target repositories they own."
        : "No recent PRs from you to their repos loaded yet.",
    },
    {
      label: "Shared third-party repos",
      value: sharedThirdPartyRepoAddresses.length,
      description: sharedThirdPartyRepoAddresses.length
        ? "You both have recent or declared activity on the same repos owned by someone else."
        : "No third-party repo overlap loaded yet.",
    },
  ])
  const strongestConnection = $derived.by(() => {
    if (!canShowRelativeAnalysis) return ""
    if (targetMaintainsViewerRepos.length) return "maintains repositories you own"
    if (targetContributedToViewerRepos.length)
      return "has contributed pull requests to your repositories"
    if (targetMergedViewerRepoPullRequests.length)
      return "has maintainer actions on your repositories"
    if (viewerContributedToTargetRepos.length) return "owns repositories you have contributed to"
    if (commonCommunities.length) return "shares communities with you"
    if (sharedThirdPartyRepoAddresses.length) return "overlaps with you on third-party repositories"
    return "does not have a direct loaded connection to you yet"
  })

  const profileStats = $derived<ProfileStat[]>([
    {
      label: "Communities",
      value: targetCommunityRefs.length,
      description: "Membership, moderation, and owned community contexts loaded for this profile.",
    },
    {
      label: "Repos owned",
      value: targetOwnedRepos.length,
      description: "Repository announcements authored by this profile.",
    },
    {
      label: "Repos maintained",
      value: targetMaintainedRepos.length,
      description: "Repositories where this profile is listed as maintainer but is not the owner.",
    },
    {
      label: "Recent PRs",
      value: targetAuthoredPullRequests.length,
      description: "Pull requests authored in the current activity window.",
    },
    {
      label: "Maintainer actions",
      value: targetAppliedStatuses.length,
      description: "Recent applied git status events authored by this profile.",
    },
    {
      label: "Issues",
      value: targetIssues.length,
      description: "Recent git issues authored by this profile.",
    },
  ])

  let recentActionsExpanded = $state(false)

  const recentActions = $derived.by<RecentAction[]>(() => {
    const actions: RecentAction[] = []

    for (const event of targetOwnedRepos.slice(0, 8)) {
      actions.push({
        id: event.id,
        kind: "repo",
        label: "announced repo",
        title: getRepoName(event),
        context: "Repository",
        createdAt: event.created_at,
        href: getRepoHref(event),
      })
    }

    for (const event of targetAuthoredPullRequests.slice(0, 12)) {
      const repoAddress = getRepoAddressFromRoot(event)
      const repoEvent = latestRepoEventsByAddress.get(repoAddress)
      const repoHref = getRepoHref(repoEvent)
      actions.push({
        id: event.id,
        kind: "pr",
        label: "opened PR",
        title: getRootSubject(event),
        context: getRepoName(repoEvent),
        createdAt: event.created_at,
        href: repoHref ? `${repoHref}/prs/${event.id}` : "",
      })
    }

    for (const event of targetIssues.slice(0, 12)) {
      const repoAddress = getRepoAddressFromRoot(event)
      const repoEvent = latestRepoEventsByAddress.get(repoAddress)
      const repoHref = getRepoHref(repoEvent)
      actions.push({
        id: event.id,
        kind: "issue",
        label: "opened issue",
        title: getRootSubject(event),
        context: getRepoName(repoEvent),
        createdAt: event.created_at,
        href: repoHref ? `${repoHref}/issues/${event.id}` : "",
      })
    }

    for (const event of targetAppliedStatuses.slice(0, 12)) {
      const rootId = getStatusRootId(event)
      const pullRequest = pullRequestsById.get(rootId)
      const repoEvent = pullRequest
        ? latestRepoEventsByAddress.get(getRepoAddressFromRoot(pullRequest))
        : undefined
      const repoHref = getRepoHref(repoEvent)
      actions.push({
        id: event.id,
        kind: "status",
        label: "applied PR status",
        title: pullRequest ? getRootSubject(pullRequest) : "Pull request status",
        context: getRepoName(repoEvent),
        createdAt: event.created_at,
        href: repoHref && rootId ? `${repoHref}/prs/${rootId}` : "",
      })
    }

    for (const event of targetGitComments.slice(0, 16)) {
      const repoAddress = getGitCommentRepoAddress(event)
      const repoEvent = latestRepoEventsByAddress.get(repoAddress)
      const repoHref = getRepoHref(repoEvent)
      const rootId = getGitCommentRootId(event)
      const rootKind = getGitCommentRootKind(event)
      const filePath = getGitCommentFilePath(event)
      const title = filePath
        ? `${filePath}${getGitCommentLineLabel(event)}`
        : event.content?.split("\n")[0]?.slice(0, 80) || "Git comment"
      const href =
        repoHref && rootId
          ? rootKind === GIT_ISSUE
            ? `${repoHref}/issues/${rootId}#comment-${event.id}`
            : rootKind === GIT_PULL_REQUEST
              ? `${repoHref}/prs/${rootId}#comment-${event.id}`
              : repoHref
          : repoHref

      actions.push({
        id: event.id,
        kind: filePath ? "snippet" : "comment",
        label: filePath ? "added snippet" : "commented",
        title,
        context: getRepoName(repoEvent),
        createdAt: event.created_at,
        href,
      })
    }

    for (const event of $communityActivityEvents.slice(-12)) {
      const communityPubkey = getTagValue("h", event.tags || [])
      actions.push({
        id: event.id,
        kind: "community",
        label:
          event.kind === THREAD
            ? "started thread"
            : event.kind === MESSAGE
              ? "posted message"
              : "commented",
        title:
          getTagValue("subject", event.tags || []) ||
          event.content?.split("\n")[0]?.slice(0, 80) ||
          "Community activity",
        context: communityPubkey ? `Community ${formatShortNpub(communityPubkey)}` : "Community",
        createdAt: event.created_at,
        href: communityPubkey ? makeCommunityPath(communityPubkey) : "",
      })
    }

    return actions
      .filter(action => action.createdAt)
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  })
  const visibleRecentActions = $derived(
    recentActionsExpanded ? recentActions : recentActions.slice(0, RECENT_ACTION_PREVIEW_LIMIT),
  )

  const openBack = () => history.back()

  onMount(() => {
    if (!parsedProfile) goto("/people", {replaceState: true})
  })

  $effect(() => {
    if (!targetPubkey) return

    loadProfile(targetPubkey, profileRelayHints).catch(() => undefined)
  })

  $effect(() => {
    if (!targetPubkey || communityRelays.length === 0) return

    const filters = [...targetCommunityProfileListFilters, ...targetCommunityDefinitionFilters]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({
      relays: communityRelays,
      filters: filters as any,
      autoClose: true,
      signal: controller.signal,
    }).catch(() => undefined)

    return () => controller.abort()
  })

  $effect(() => {
    if (!targetPubkey || communityRelays.length === 0 || communityActivityFilters.length === 0)
      return

    const controller = new AbortController()
    request({
      relays: communityRelays,
      filters: communityActivityFilters as any,
      autoClose: true,
      signal: controller.signal,
    }).catch(() => undefined)

    return () => controller.abort()
  })

  $effect(() => {
    if (!targetPubkey || gitRelays.length === 0) return

    loadRepoAnnouncements(gitRelays).catch(() => undefined)
  })

  $effect(() => {
    if (!targetPubkey || gitRelays.length === 0) return

    const filters = [...publicGitFilters, ...relativeGitFilters, ...statusContextFilters]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({
      relays: gitRelays,
      filters: filters as any,
      autoClose: true,
      signal: controller.signal,
    }).catch(() => undefined)

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <button type="button" class="center" onclick={openBack} aria-label="Go back">
      <Icon icon={AltArrowLeft} />
    </button>
  {/snippet}
  {#snippet title()}
    <div class="flex min-w-0 items-center gap-2">
      <Icon icon={UserCircle} class="shrink-0" />
      <strong class="truncate">{profileLabel}</strong>
    </div>
  {/snippet}
  {#snippet action()}
    {#if targetPubkey && !isSelf && chatPath}
      <Link href={chatPath} class="btn btn-circle btn-primary btn-sm">
        <Icon icon={Letter} />
      </Link>
    {/if}
  {/snippet}
</PageBar>

<PageContent class="p-2 sm:p-4">
  {#if targetPubkey}
    <div class="mx-auto flex w-full max-w-7xl flex-col gap-4 pb-8">
      <section class="card2 bg-alt overflow-hidden shadow-md">
        <div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div class="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
            <ProfileCircle
              pubkey={targetPubkey}
              relays={profileRelayHints}
              size={24}
              class="shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h1 class="min-w-0 break-words text-3xl font-bold leading-tight">
                  <ProfileName pubkey={targetPubkey} url={profileRelayHints[0]} />
                </h1>
                {#if isSelf}
                  <span class="badge badge-primary">You</span>
                {/if}
              </div>
              <div class="mt-1 break-all text-sm opacity-70">
                {profile?.nip05 || formatShortNpub(targetPubkey)}
              </div>
              <div class="mt-4 max-w-3xl text-sm leading-relaxed opacity-90">
                <ProfileInfo pubkey={targetPubkey} relays={profileRelayHints} />
              </div>
              <div class="mt-4">
                <ProfileBadges pubkey={targetPubkey} url={profileRelayHints[0]} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <details class="card2 bg-alt group shadow-md">
        <summary
          class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-box py-1 pr-2 [&::-webkit-details-marker]:hidden">
          <h2 class="flex items-center gap-2 text-xl font-semibold">
            <Icon icon={NotesMinimalistic} />
            Recent actions
          </h2>
          <div class="flex shrink-0 items-center gap-2">
            <span class="badge badge-neutral">{formatCount(recentActions.length, "action")}</span>
            <div class="transition-transform group-open:rotate-180">
              <Icon icon={AltArrowDown} />
            </div>
          </div>
        </summary>

        <div class="mt-4 flex flex-col gap-2 border-t border-base-300/60 pt-4">
          {#each visibleRecentActions as action (action.id)}
            {#if action.href}
              <Link href={action.href} class="rounded-box bg-base-200/60 p-4 hover:bg-base-200">
                <div class="flex min-w-0 items-start gap-3">
                  <div class="center h-9 w-9 shrink-0 rounded-full bg-base-100">
                    {#if action.kind === "community"}
                      <Icon icon={Hashtag} size={5} />
                    {:else if action.kind === "repo"}
                      <Icon icon={Git} size={5} />
                    {:else if action.kind === "status"}
                      <Icon icon={ShieldCheck} size={5} />
                    {:else}
                      <Icon icon={Code2} size={5} />
                    {/if}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2 text-sm">
                      <span class="font-medium">{action.label}</span>
                      <span class="opacity-50">-</span>
                      <span class="opacity-70">{formatTimestampRelative(action.createdAt)}</span>
                    </div>
                    <div class="mt-1 truncate font-medium">{action.title}</div>
                    <div class="mt-1 truncate text-xs opacity-65">{action.context}</div>
                  </div>
                </div>
              </Link>
            {:else}
              <div class="rounded-box bg-base-200/60 p-4">
                <div class="flex min-w-0 items-start gap-3">
                  <div class="center h-9 w-9 shrink-0 rounded-full bg-base-100">
                    {#if action.kind === "community"}
                      <Icon icon={Hashtag} size={5} />
                    {:else if action.kind === "repo"}
                      <Icon icon={Git} size={5} />
                    {:else if action.kind === "status"}
                      <Icon icon={ShieldCheck} size={5} />
                    {:else}
                      <Icon icon={Code2} size={5} />
                    {/if}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2 text-sm">
                      <span class="font-medium">{action.label}</span>
                      <span class="opacity-50">-</span>
                      <span class="opacity-70">{formatTimestampRelative(action.createdAt)}</span>
                    </div>
                    <div class="mt-1 truncate font-medium">{action.title}</div>
                    <div class="mt-1 truncate text-xs opacity-65">{action.context}</div>
                  </div>
                </div>
              </div>
            {/if}
          {:else}
            <div class="rounded-box bg-base-200/60 p-4 text-sm opacity-75">
              No recent public Budabit actions loaded for this profile yet.
            </div>
          {/each}

          {#if recentActions.length > RECENT_ACTION_PREVIEW_LIMIT}
            <button
              type="button"
              class="btn btn-neutral btn-sm self-center"
              onclick={() => (recentActionsExpanded = !recentActionsExpanded)}>
              {recentActionsExpanded
                ? "Show less"
                : `Show ${recentActions.length - RECENT_ACTION_PREVIEW_LIMIT} more`}
            </button>
          {/if}
        </div>
      </details>

      {#if canShowRelativeAnalysis}
        <details class="card2 bg-alt group shadow-md">
          <summary
            class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-box py-1 pr-2 [&::-webkit-details-marker]:hidden">
            <h2 class="flex items-center gap-2 text-xl font-semibold">
              <Icon icon={ShieldCheck} />
              Connection analysis
            </h2>
            <div class="flex shrink-0 items-center gap-2">
              <div class="transition-transform group-open:rotate-180">
                <Icon icon={AltArrowDown} />
              </div>
            </div>
          </summary>

          <div class="mt-4 border-t border-base-300/60 pt-4">
            <p class="text-sm opacity-75">{profileLabel} {strongestConnection}.</p>

            <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {#each connectionRows as row (row.label)}
                <div class="rounded-box bg-base-200/60 p-4">
                  <div class="flex items-start justify-between gap-3">
                    <div class="text-sm font-medium">{row.label}</div>
                    <div class="badge badge-neutral px-3 py-3 text-sm tabular-nums">
                      {row.value}
                    </div>
                  </div>
                  <p class="mt-2 text-xs opacity-70">{row.description}</p>
                  {#if row.href}
                    <Link
                      href={row.href}
                      class="mt-3 inline-flex text-xs font-medium text-primary hover:underline">
                      View evidence
                    </Link>
                  {/if}
                </div>
              {/each}
            </div>

            {#if commonCommunities.length > 0}
              <div class="mt-4 border-t border-base-300/60 pt-4">
                <div class="mb-2 text-sm font-semibold">Common communities</div>
                <div class="flex flex-wrap gap-2">
                  {#each commonCommunities.slice(0, 8) as item (item.target.communityPubkey)}
                    <Link
                      href={makeCommunityPath(item.target.communityPubkey)}
                      class="badge badge-neutral h-auto gap-2 py-2">
                      <ProfileCircle
                        pubkey={item.target.communityPubkey}
                        relays={item.target.relayHints}
                        size={5} />
                      <ProfileName
                        pubkey={item.target.communityPubkey}
                        url={item.target.relayHints[0]} />
                    </Link>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </details>
      {/if}

      <details class="card2 bg-alt group shadow-md">
        <summary
          class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-box py-1 pr-2 [&::-webkit-details-marker]:hidden">
          <h2 class="flex items-center gap-2 text-xl font-semibold">
            <Icon icon={Git} />
            Repositories
          </h2>
          <div class="flex shrink-0 items-center gap-2">
            <span class="badge badge-neutral">Last 180 days</span>
            <div class="transition-transform group-open:rotate-180">
              <Icon icon={AltArrowDown} />
            </div>
          </div>
        </summary>

        <div class="mt-4 grid gap-3 border-t border-base-300/60 pt-4 md:grid-cols-2">
          <div class="rounded-box bg-base-200/60 p-4">
            <div class="text-sm font-semibold">Owned repositories</div>
            <div class="mt-3 flex flex-col gap-2">
              {#each targetOwnedRepos.slice(0, 5) as repo (getRepoAddress(repo))}
                <Link
                  href={getRepoHref(repo)}
                  class="rounded-box bg-base-100/50 p-3 hover:bg-base-100">
                  <div class="font-medium">{getRepoName(repo)}</div>
                  <div class="text-xs opacity-60">
                    Announced {formatTimestampRelative(repo.created_at)}
                  </div>
                </Link>
              {:else}
                <div class="text-sm opacity-70">No owned repository announcements loaded.</div>
              {/each}
            </div>
          </div>

          <div class="rounded-box bg-base-200/60 p-4">
            <div class="text-sm font-semibold">Maintained repositories</div>
            <div class="mt-3 flex flex-col gap-2">
              {#each targetMaintainedRepos.slice(0, 5) as repo (getRepoAddress(repo))}
                <Link
                  href={getRepoHref(repo)}
                  class="rounded-box bg-base-100/50 p-3 hover:bg-base-100">
                  <div class="font-medium">{getRepoName(repo)}</div>
                  <div class="text-xs opacity-60">Owner <ProfileName pubkey={repo.pubkey} /></div>
                </Link>
              {:else}
                <div class="text-sm opacity-70">No maintained repositories loaded.</div>
              {/each}
            </div>
          </div>
        </div>
      </details>

      <details class="card2 bg-alt group shadow-md">
        <summary
          class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-box py-1 pr-2 [&::-webkit-details-marker]:hidden">
          <h2 class="flex items-center gap-2 text-xl font-semibold">
            <Icon icon={UsersGroup} />
            Community participation
          </h2>
          <div class="flex shrink-0 items-center gap-2">
            <span class="badge badge-neutral"
              >{formatCount(targetCommunityRefs.length, "community", "communities")}</span>
            <div class="transition-transform group-open:rotate-180">
              <Icon icon={AltArrowDown} />
            </div>
          </div>
        </summary>

        <div class="mt-4 border-t border-base-300/60 pt-4">
          {#if targetCommunityRefs.length > 0}
            <div class="grid gap-3 md:grid-cols-2">
              {#each targetCommunityRefs.slice(0, 12) as ref (ref.communityPubkey)}
                <Link
                  href={makeCommunityPath(ref.communityPubkey)}
                  class="rounded-box bg-base-200/60 p-4 hover:bg-base-200">
                  <div class="flex min-w-0 items-start gap-3">
                    <ProfileCircle pubkey={ref.communityPubkey} relays={ref.relayHints} size={9} />
                    <div class="min-w-0 flex-1">
                      <div class="truncate font-medium">
                        <ProfileName pubkey={ref.communityPubkey} url={ref.relayHints[0]} />
                      </div>
                      <div class="mt-2 flex flex-wrap gap-1">
                        {#each ref.roles as role}
                          <span class="badge badge-primary badge-sm capitalize">{role}</span>
                        {/each}
                      </div>
                      {#if ref.writableSections.length > 0}
                        <div class="mt-2 text-xs opacity-70">
                          Can participate in {ref.writableSections.slice(0, 4).join(", ")}{ref
                            .writableSections.length > 4
                            ? "..."
                            : ""}
                        </div>
                      {/if}
                    </div>
                  </div>
                </Link>
              {/each}
            </div>
          {:else}
            <div class="rounded-box bg-base-200/60 p-4 text-sm opacity-75">
              No community memberships or moderation roles loaded for this profile yet.
            </div>
          {/if}
        </div>
      </details>

      <details class="card2 bg-alt group shadow-md">
        <summary
          class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-box py-1 pr-2 [&::-webkit-details-marker]:hidden">
          <h2 class="flex items-center gap-2 text-xl font-semibold">
            <Icon icon={ShieldCheck} />
            Stats
          </h2>
          <div class="flex shrink-0 items-center gap-2">
            <span class="badge badge-neutral">{formatCount(profileStats.length, "metric")}</span>
            <div class="transition-transform group-open:rotate-180">
              <Icon icon={AltArrowDown} />
            </div>
          </div>
        </summary>

        <div class="mt-4 flex flex-col gap-4 border-t border-base-300/60 pt-4">
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {#each profileStats as stat (stat.label)}
              <div class="rounded-box bg-base-200/60 p-3">
                <div class="text-xs uppercase tracking-wide opacity-60">{stat.label}</div>
                <div class="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</div>
                <div class="mt-1 text-xs opacity-60">{stat.description}</div>
              </div>
            {/each}
          </div>

          <ProfileNip85Metrics pubkey={targetPubkey} />
          <ProfileCodeTrustAnalysis pubkey={targetPubkey} />
        </div>
      </details>
    </div>
  {:else}
    <div class="card2 bg-alt mx-auto mt-4 max-w-xl shadow-md">
      <h1 class="text-xl font-semibold">Profile not found</h1>
      <p class="mt-2 text-sm opacity-75">
        This profile link does not contain a valid npub, nprofile, or hex pubkey.
      </p>
      <Link href="/people" class="btn btn-primary mt-4">Back to people</Link>
    </div>
  {/if}
</PageContent>
