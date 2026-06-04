<script lang="ts">
  import {onMount} from "svelte"
  import * as nip19 from "nostr-tools/nip19"
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {Router} from "@welshman/router"
  import {Address, displayPubkey, getTagValue, type Filter, type TrustedEvent} from "@welshman/util"
  import {deriveEventsAsc, deriveEventsById, deriveEventsDesc} from "@welshman/store"
  import {profilesByPubkey, pubkey as sessionPubkey, repository} from "@welshman/app"
  import {
    GIT_REPO_ANNOUNCEMENT,
    type BookmarkAddress,
    type RepoAnnouncementEvent,
  } from "@nostr-git/core/events"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Copy from "@assets/icons/copy.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Letter from "@assets/icons/letter-opened.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import PenNewSquare from "@assets/icons/pen-new-square.svg?dataurl"
  import UserCircle from "@assets/icons/user-circle.svg?dataurl"
  import UsersGroup from "@assets/icons/users-group-rounded.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import Link from "@lib/components/Link.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import ProfileAdvancedSettings from "@app/components/ProfileAdvancedSettings.svelte"
  import ProfileAccountSettings from "@app/components/ProfileAccountSettings.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileEdit from "@app/components/ProfileEdit.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileInfo from "@app/components/ProfileInfo.svelte"
  import ProfileBadges from "@app/components/ProfileBadges.svelte"
  import RepoCollectButton from "@app/components/RepoCollectButton.svelte"
  import {activeUserCommunityRefs, COMMUNITY_DISCOVERY_RELAYS} from "@app/core/community-state"
  import {COMMUNITY_DEFINITION_KIND, PROFILE_LIST_KIND} from "@app/core/community"
  import {selectUserCommunityRefs, type ActiveUserCommunityRef} from "@app/core/community-membership"
  import {makeCommunityDefinitionProfileListRefFilters} from "@app/util/community-preferences"
  import {getRepoAnnouncementRelays, getRepoMaintainers} from "@app/core/git-state"
  import {
    buildBookmarkRepoFilters,
    matchBookmarkedRepoEvents,
  } from "@app/util/bookmarks"
  import {loadBudabitProfile} from "@app/core/profile-resolver"
  import {formatShortNpub, normalizePubkey} from "@app/util/pubkeys"
  import {makeRepoHrefFromEvent} from "@app/util/repo-links"
  import {
    makeRecentRepoStarDeleteFilter,
    makeRepoStarDeleteFilter,
    makeRepoStarReactionFilter,
    repoStarToBookmarkAddress,
    selectActiveRepoStars,
  } from "@app/util/repo-stars"
  import {makeChatPath, makeCommunityPath} from "@app/util/routes"
  import {pushModal} from "@app/util/modal"
  import {clip} from "@app/util/toast"

  type ParsedProfileRoute = {
    pubkey: string
    relays: string[]
  }

  type RepoHistory = {
    address: string
    latest: RepoAnnouncementEvent
    latestCreatedAt: number
  }

  type RepoProfileTab = "owned" | "starred"

  const PROFILE_EVENT_LIMIT = 200
  const COMMUNITY_PREVIEW_LIMIT = 10
  const COMMUNITY_DESCRIPTION_LIMIT = 200
  const REPO_PREVIEW_LIMIT = 10
  const MAINTAINER_PREVIEW_LIMIT = 4

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

  const getRepoDescription = (event: RepoAnnouncementEvent) =>
    getTagValue("description", event.tags || []) || event.content?.trim() || ""

  const getRepoSearchText = (event: RepoAnnouncementEvent) =>
    [
      getRepoName(event),
      getRepoDescription(event),
      getRepoAddress(event),
      event.pubkey,
      ...getRepoMaintainers(event),
    ]
      .join(" ")
      .toLowerCase()

  const getRepoHref = (event?: RepoAnnouncementEvent | null) => {
    if (!event) return ""

    return makeRepoHrefFromEvent(event, {fallbackRelays: profileRelayHints, gitRelays})
  }

  const isDeletedRepoAnnouncement = (event?: RepoAnnouncementEvent | null) =>
    Boolean(event?.tags?.some(tag => tag[0] === "deleted"))

  const uniq = <T,>(values: T[]) => Array.from(new Set(values.filter(Boolean))) as T[]

  const getOutboxRelays = (pubkey: string) => {
    if (!pubkey) return []

    try {
      return Router.get().FromPubkeys([pubkey]).getUrls() || []
    } catch {
      return []
    }
  }

  const getRepoHistoriesByAddress = (events: RepoAnnouncementEvent[]) => {
    const histories = new Map<string, RepoHistory>()

    for (const event of events) {
      const address = getRepoAddress(event)
      if (!address) continue

      const current = histories.get(address)
      if (!current) {
        histories.set(address, {
          address,
          latest: event,
          latestCreatedAt: event.created_at,
        })
        continue
      }

      const latest = event.created_at > current.latestCreatedAt ? event : current.latest

      histories.set(address, {
        address,
        latest,
        latestCreatedAt: latest.created_at,
      })
    }

    return histories
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
  const chatPath = $derived(targetPubkey ? makeChatPath(targetPubkey) : "")
  const targetNpub = $derived(targetPubkey ? nip19.npubEncode(targetPubkey) : "")

  let previousProfilePubkey = $state("")
  let communitiesExpanded = $state(false)
  let activeRepoTab = $state<RepoProfileTab>("owned")
  let ownedReposExpanded = $state(false)
  let starredReposExpanded = $state(false)
  let repoSearchQuery = $state("")
  let maintainerPopoverAddress = $state("")

  const communityRelays = $derived(uniq([...profileRelayHints, ...COMMUNITY_DISCOVERY_RELAYS]))
  const gitRelays = $derived(getRepoAnnouncementRelays(profileRelayHints))
  const targetOutboxRelays = $derived(getOutboxRelays(targetPubkey))

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
  const visibleCommunityRefs = $derived(
    communitiesExpanded ? targetCommunityRefs : targetCommunityRefs.slice(0, COMMUNITY_PREVIEW_LIMIT),
  )
  const viewerCommunityPubkeys = $derived(
    new Set($activeUserCommunityRefs.map(ref => ref.communityPubkey)),
  )
  const getCommunityDescription = (ref: ActiveUserCommunityRef) => {
    const description = ref.definition.description?.trim() || ""

    return description.length > COMMUNITY_DESCRIPTION_LIMIT
      ? `${description.slice(0, COMMUNITY_DESCRIPTION_LIMIT).trimEnd()}...`
      : description
  }
  const isSharedCommunity = (communityPubkey: string) =>
    !isSelf && viewerCommunityPubkeys.has(communityPubkey)
  const repoAnnouncementFilters = $derived<Filter[]>([
    ...(targetPubkey
      ? [{kinds: [GIT_REPO_ANNOUNCEMENT], authors: [targetPubkey], limit: PROFILE_EVENT_LIMIT}]
      : []),
  ])
  const repoAnnouncementEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: repoAnnouncementFilters})),
  )
  const repoHistoriesByAddress = $derived(
    getRepoHistoriesByAddress($repoAnnouncementEvents as RepoAnnouncementEvent[]),
  )
  const latestRepoEventsByAddress = $derived(
    new Map(
      Array.from(repoHistoriesByAddress.entries()).map(
        ([address, history]) => [address, history.latest] as const,
      ),
    ),
  )
  const repoEvents = $derived(Array.from(latestRepoEventsByAddress.values()))
  const targetOwnedRepos = $derived(
    repoEvents
      .filter(event => event.pubkey === targetPubkey)
      .sort((a, b) => b.created_at - a.created_at),
  )

  const targetRepoStarRelays = $derived(
    uniq([...profileRelayHints, ...targetOutboxRelays, ...gitRelays]),
  )
  const targetRepoStarReactionFilters = $derived.by(() => {
    const filter = makeRepoStarReactionFilter(targetPubkey)

    return filter ? [filter] : []
  })
  const targetRepoStarReactionEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetRepoStarReactionFilters})),
  )
  const targetRepoStarDeleteFilters = $derived.by(() =>
    [
      makeRepoStarDeleteFilter(
        targetPubkey,
        $targetRepoStarReactionEvents as TrustedEvent[],
      ),
      makeRecentRepoStarDeleteFilter(targetPubkey),
    ].filter(Boolean) as Filter[],
  )
  const targetRepoStarDeleteEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetRepoStarDeleteFilters})),
  )
  const targetRepoStars = $derived.by(() =>
    selectActiveRepoStars({
      reactions: $targetRepoStarReactionEvents as TrustedEvent[],
      deleteEvents: $targetRepoStarDeleteEvents as TrustedEvent[],
      author: targetPubkey,
    }),
  )
  const targetRepoStarAddresses = $derived.by((): BookmarkAddress[] =>
    targetRepoStars.map(repoStarToBookmarkAddress),
  )
  const starredRepoAnnouncementFilters = $derived.by(() =>
    buildBookmarkRepoFilters(targetRepoStarAddresses),
  )
  const starredRepoAnnouncementEvents = $derived(
    deriveEventsDesc(deriveEventsById({repository, filters: starredRepoAnnouncementFilters})),
  )
  const starredRepoLoadRelays = $derived(
    uniq([
      ...targetRepoStarAddresses.map(address => address.relayHint),
      ...targetOutboxRelays,
      ...gitRelays,
    ]),
  )
  const loadedStarredRepos = $derived.by(() =>
    matchBookmarkedRepoEvents({
      bookmarks: targetRepoStarAddresses,
      events: $starredRepoAnnouncementEvents as RepoAnnouncementEvent[],
      getCachedEvent: address => repository.getEvent(address) as RepoAnnouncementEvent | undefined,
      isDeleted: isDeletedRepoAnnouncement,
      getFallbackRelayHint: event => Router.get().getRelaysForPubkey(event.pubkey)?.[0] || "",
    }),
  )
  const targetStarredRepos = $derived(loadedStarredRepos.map(repo => repo.event))
  const activeRepoEvents = $derived(
    activeRepoTab === "owned" ? targetOwnedRepos : targetStarredRepos,
  )
  const normalizedRepoSearchQuery = $derived(repoSearchQuery.trim().toLowerCase())
  const filteredActiveRepoEvents = $derived(
    normalizedRepoSearchQuery
      ? activeRepoEvents.filter(repo => getRepoSearchText(repo).includes(normalizedRepoSearchQuery))
      : activeRepoEvents,
  )
  const activeReposExpanded = $derived(
    activeRepoTab === "owned" ? ownedReposExpanded : starredReposExpanded,
  )
  const visibleProfileRepos = $derived(
    activeReposExpanded
      ? filteredActiveRepoEvents
      : filteredActiveRepoEvents.slice(0, REPO_PREVIEW_LIMIT),
  )
  const activeRepoEmptyMessage = $derived(
    normalizedRepoSearchQuery
      ? "No repositories match this search."
      : activeRepoTab === "owned"
      ? "No owned repos loaded for this profile yet."
      : targetRepoStars.length > 0
        ? "Starred repos are still loading for this profile."
        : "No starred repos loaded for this profile yet.",
  )
  const getRepoMaintainerPreview = (event: RepoAnnouncementEvent) =>
    getRepoMaintainers(event).slice(0, MAINTAINER_PREVIEW_LIMIT)
  const getHiddenRepoMaintainerCount = (event: RepoAnnouncementEvent) =>
    Math.max(0, getRepoMaintainers(event).length - MAINTAINER_PREVIEW_LIMIT)
  const getRepoOwnerRelays = (event: RepoAnnouncementEvent) =>
    uniq([Router.get().getRelaysForPubkey(event.pubkey)?.[0] || "", ...profileRelayHints])
  const getRepoRelayHint = (event: RepoAnnouncementEvent) =>
    Router.get().getRelaysForPubkey(event.pubkey)?.[0] ||
    getTagValue("relays", event.tags || []) ||
    profileRelayHints[0] ||
    gitRelays[0] ||
    ""
  const openRepoOwnerProfile = (event: RepoAnnouncementEvent) => {
    pushModal(ProfileDetail, {pubkey: event.pubkey, relays: getRepoOwnerRelays(event)})
  }
  const toggleMaintainerPopover = (address: string) => {
    maintainerPopoverAddress = maintainerPopoverAddress === address ? "" : address
  }
  const closeMaintainerPopover = () => {
    maintainerPopoverAddress = ""
  }
  const selectRepoTab = (tab: RepoProfileTab) => {
    activeRepoTab = tab
    maintainerPopoverAddress = ""
  }
  const toggleActiveRepoExpansion = () => {
    if (activeRepoTab === "owned") {
      ownedReposExpanded = !ownedReposExpanded
    } else {
      starredReposExpanded = !starredReposExpanded
    }
  }
  function copyTargetNpub() {
    if (targetNpub) clip(targetNpub)
  }

  function copyTargetNip05() {
    if (profile?.nip05) clip(profile.nip05)
  }

  const startEdit = () => pushModal(ProfileEdit)

  const openBack = () => history.back()

  onMount(() => {
    if (!parsedProfile) goto("/people", {replaceState: true})
  })

  $effect(() => {
    if (targetPubkey === previousProfilePubkey) return

    previousProfilePubkey = targetPubkey
    communitiesExpanded = false
    activeRepoTab = "owned"
    ownedReposExpanded = false
    starredReposExpanded = false
    repoSearchQuery = ""
    maintainerPopoverAddress = ""
  })

  $effect(() => {
    if (!targetPubkey) return

    loadBudabitProfile(targetPubkey, {relays: profileRelayHints}).catch(() => undefined)
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
    if (!targetPubkey || gitRelays.length === 0) return

    if (repoAnnouncementFilters.length === 0) return

    const controller = new AbortController()
    request({
      relays: gitRelays,
      filters: repoAnnouncementFilters as any,
      autoClose: true,
      signal: controller.signal,
    }).catch(() => undefined)

    return () => controller.abort()
  })

  $effect(() => {
    if (!targetPubkey || targetRepoStarRelays.length === 0) return
    if (targetRepoStarReactionFilters.length === 0) return

    const controller = new AbortController()
    request({
      relays: targetRepoStarRelays,
      filters: targetRepoStarReactionFilters as any,
      autoClose: true,
      signal: controller.signal,
    }).catch(error => {
      console.warn("[people/profile] Failed to load profile repo stars", error)
    })

    return () => controller.abort()
  })

  $effect(() => {
    if (!targetPubkey || targetRepoStarRelays.length === 0) return
    if (targetRepoStarDeleteFilters.length === 0) return

    const controller = new AbortController()
    request({
      relays: targetRepoStarRelays,
      filters: targetRepoStarDeleteFilters as any,
      autoClose: true,
      signal: controller.signal,
    }).catch(error => {
      console.warn("[people/profile] Failed to load profile repo star deletes", error)
    })

    return () => controller.abort()
  })

  $effect(() => {
    if (!targetPubkey || starredRepoLoadRelays.length === 0) return
    if (starredRepoAnnouncementFilters.length === 0) return

    const controller = new AbortController()
    request({
      relays: starredRepoLoadRelays,
      filters: starredRepoAnnouncementFilters as any,
      autoClose: true,
      signal: controller.signal,
    }).catch(error => {
      console.warn("[people/profile] Failed to load profile starred repos", error)
    })

    return () => controller.abort()
  })
</script>

<PageBar class="cw-full">
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
    {#if !isSelf && targetPubkey && chatPath}
      <Link href={chatPath} class="btn btn-circle btn-primary btn-sm">
        <Icon icon={Letter} />
      </Link>
    {/if}
  {/snippet}
</PageBar>

<PageContent class="cw-full px-1.5 pb-1.5 pt-4 sm:px-4 sm:pb-4 sm:pt-8">
  {#if targetPubkey}
    <div class="mx-auto flex w-full max-w-7xl flex-col gap-2.5 pb-5 sm:gap-4 sm:pb-8">
      <section class="card2 bg-alt overflow-hidden !p-3 shadow-md sm:!p-6">
        <div class="flex flex-col gap-3 sm:gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
            <ProfileCircle
              pubkey={targetPubkey}
              relays={profileRelayHints}
              size={16}
              class="shrink-0 sm:hidden" />
            <ProfileCircle
              pubkey={targetPubkey}
              relays={profileRelayHints}
              size={24}
              class="hidden shrink-0 sm:block" />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h1 class="min-w-0 break-words text-2xl font-bold leading-tight sm:text-3xl">
                  <ProfileName pubkey={targetPubkey} url={profileRelayHints[0]} />
                </h1>
                {#if isSelf}
                  <span class="badge badge-primary badge-sm sm:badge-md">You</span>
                  <Button
                    class="btn btn-neutral btn-xs min-h-0 px-2 sm:btn-sm"
                    onclick={startEdit}>
                    <Icon icon={PenNewSquare} size={4} />
                    Edit profile
                  </Button>
                {/if}
              </div>
              {#if !isSelf}
                <div
                  class="mt-1 flex max-w-3xl flex-col gap-1.5 break-all text-xs opacity-70 sm:text-sm">
                  {#if profile?.nip05}
                    <div class="flex min-w-0 items-center gap-1.5 sm:gap-2">
                      <span class="min-w-0">{profile.nip05}</span>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs h-auto min-h-0 shrink-0 px-1 py-1"
                        title="Copy profile nip05"
                        aria-label="Copy profile nip05"
                        onclick={copyTargetNip05}>
                        <Icon size={4} icon={Copy} />
                      </button>
                    </div>
                  {/if}
                  {#if targetNpub}
                    <div class="flex min-w-0 items-center gap-1.5 sm:gap-2">
                      <span class="min-w-0">{displayPubkey(targetPubkey)}</span>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs h-auto min-h-0 shrink-0 px-1 py-1"
                        title="Copy profile npub"
                        aria-label="Copy profile npub"
                        onclick={copyTargetNpub}>
                        <Icon size={4} icon={Copy} />
                      </button>
                    </div>
                  {/if}
                </div>
              {/if}
              <div class="mt-3 max-w-3xl text-xs leading-relaxed opacity-90 sm:mt-4 sm:text-sm">
                <ProfileInfo pubkey={targetPubkey} relays={profileRelayHints} />
              </div>
              <div class="mt-3 sm:mt-4">
                <ProfileBadges pubkey={targetPubkey} url={profileRelayHints[0]} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {#if isSelf}
        <ProfileAccountSettings />
      {/if}

      <details open class="card2 bg-alt group !p-3 shadow-md sm:!p-6">
        <summary
          class="flex cursor-pointer list-none items-center justify-between gap-2 rounded-box pr-1 sm:gap-3 sm:py-1 sm:pr-2 [&::-webkit-details-marker]:hidden">
          <h2 class="flex items-center gap-1.5 text-base font-semibold sm:gap-2 sm:text-xl">
            <Icon icon={UsersGroup} />
            Communities
          </h2>
          <div class="flex shrink-0 items-center gap-2">
            <span class="badge badge-neutral badge-sm sm:badge-md"
              >{formatCount(targetCommunityRefs.length, "community", "communities")}</span>
            <div class="transition-transform group-open:rotate-180">
              <Icon icon={AltArrowDown} />
            </div>
          </div>
        </summary>

        <div class="mt-3 border-t border-base-300/60 pt-3 sm:mt-4 sm:pt-4">
          {#if targetCommunityRefs.length > 0}
            <div class="grid gap-2 sm:gap-3 md:grid-cols-2">
              {#each visibleCommunityRefs as ref (ref.communityPubkey)}
                <Link
                  href={makeCommunityPath(ref.communityPubkey)}
                  class="rounded-box bg-base-200/60 p-3 hover:bg-base-200 sm:p-4">
                  <div class="flex min-w-0 items-start gap-2 sm:gap-3">
                    <ProfileCircle pubkey={ref.communityPubkey} relays={ref.relayHints} size={7} />
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <div class="truncate text-sm font-medium sm:text-base">
                          <ProfileName pubkey={ref.communityPubkey} url={ref.relayHints[0]} />
                        </div>
                        {#if isSharedCommunity(ref.communityPubkey)}
                          <span class="badge badge-info badge-sm">Shared</span>
                        {/if}
                      </div>
                      {#if getCommunityDescription(ref)}
                        <p class="mt-1 break-words text-xs leading-5 opacity-60">
                          {getCommunityDescription(ref)}
                        </p>
                      {/if}
                      <div class="mt-1.5 flex flex-wrap gap-1 sm:mt-2">
                        {#each ref.roles as role}
                          <span class="badge badge-primary badge-sm capitalize">{role}</span>
                        {/each}
                      </div>
                    </div>
                  </div>
                </Link>
              {:else}
                <div class="rounded-box bg-base-200/60 p-3 text-xs opacity-75 sm:p-4 sm:text-sm">
                  No community memberships or moderation roles loaded for this profile yet.
                </div>
              {/each}
            </div>
            {#if targetCommunityRefs.length > COMMUNITY_PREVIEW_LIMIT}
              <button
                type="button"
                class="btn btn-neutral btn-xs mx-auto mt-3 flex sm:btn-sm"
                onclick={() => (communitiesExpanded = !communitiesExpanded)}>
                {communitiesExpanded ? "Show less" : "Show more"}
              </button>
            {/if}
          {:else}
            <div class="rounded-box bg-base-200/60 p-3 text-xs opacity-75 sm:p-4 sm:text-sm">
              No community memberships or moderation roles loaded for this profile yet.
            </div>
          {/if}
        </div>
      </details>

      <details open class="card2 bg-alt group !p-3 shadow-md sm:!p-6">
        <summary
          class="flex cursor-pointer list-none items-center justify-between gap-2 rounded-box pr-1 sm:gap-3 sm:py-1 sm:pr-2 [&::-webkit-details-marker]:hidden">
          <h2 class="flex items-center gap-1.5 text-base font-semibold sm:gap-2 sm:text-xl">
            <Icon icon={Git} />
            Repositories
          </h2>
          <div class="flex shrink-0 items-center gap-2">
            <span class="badge badge-neutral badge-sm sm:badge-md"
              >{formatCount(targetOwnedRepos.length, "repo")}</span>
            <div class="transition-transform group-open:rotate-180">
              <Icon icon={AltArrowDown} />
            </div>
          </div>
        </summary>

        <div class="mt-3 border-t border-base-300/60 pt-3 sm:mt-4 sm:pt-4">
          <div class="flex flex-wrap gap-2" role="tablist" aria-label="Repository tabs">
            <Button
              role="tab"
              aria-selected={activeRepoTab === "owned"}
              class={`btn btn-xs sm:btn-sm ${activeRepoTab === "owned" ? "btn-primary" : "btn-ghost"}`}
              onclick={() => selectRepoTab("owned")}>
              Owned
              <span class="badge badge-sm ml-1">{targetOwnedRepos.length}</span>
            </Button>
            <Button
              role="tab"
              aria-selected={activeRepoTab === "starred"}
              class={`btn btn-xs sm:btn-sm ${activeRepoTab === "starred" ? "btn-primary" : "btn-ghost"}`}
              onclick={() => selectRepoTab("starred")}>
              Starred
              <span class="badge badge-sm ml-1">{targetRepoStars.length}</span>
            </Button>
          </div>

          <label class="input input-bordered mt-3 flex min-h-0 items-center gap-2 rounded-box bg-base-200/60 text-sm">
            <Icon icon={Magnifier} size={4} class="shrink-0 opacity-60" />
            <input
              type="search"
              class="grow bg-transparent"
              placeholder={`Search ${activeRepoTab === "owned" ? "owned" : "starred"} repos`}
              bind:value={repoSearchQuery} />
          </label>

          <div class="mt-3 flex flex-col gap-2 sm:gap-3">
            {#each visibleProfileRepos as repo (getRepoAddress(repo))}
              {@const repoAddress = getRepoAddress(repo)}
              {@const maintainers = getRepoMaintainers(repo)}
              {@const maintainerPreview = getRepoMaintainerPreview(repo)}
              {@const hiddenMaintainers = getHiddenRepoMaintainerCount(repo)}
              <div class="rounded-box bg-base-200/60 p-3 hover:bg-base-200 sm:p-4">
                <div class="flex min-w-0 flex-col gap-3">
                  <div class="flex min-w-0 items-start gap-3">
                    {#if activeRepoTab === "starred"}
                      <button
                        type="button"
                        class="shrink-0 rounded-full"
                        aria-label="Open repository owner profile"
                        onclick={() => openRepoOwnerProfile(repo)}>
                        <ProfileCircle pubkey={repo.pubkey} relays={getRepoOwnerRelays(repo)} size={10} />
                      </button>
                    {:else}
                      <div class="center h-9 w-9 shrink-0 rounded-full bg-base-100 sm:h-10 sm:w-10">
                        <Icon icon={Git} size={4} />
                      </div>
                    {/if}
                    <Link href={getRepoHref(repo)} class="min-w-0 flex-1">
                      <div class="min-w-0">
                        <div class="truncate text-sm font-medium sm:text-base">
                          {getRepoName(repo)}
                        </div>
                        {#if getRepoDescription(repo)}
                          <p class="mt-1 text-xs leading-5 opacity-60 sm:text-sm">
                            {getRepoDescription(repo)}
                          </p>
                        {/if}
                      </div>
                    </Link>
                    <RepoCollectButton
                      event={repo}
                      relayHint={getRepoRelayHint(repo)}
                      relayHints={[...profileRelayHints, ...gitRelays]}
                      class="btn btn-circle btn-ghost btn-xs shrink-0 opacity-70 sm:btn-sm"
                      iconClass="h-4 w-4" />
                  </div>
                  <div class="relative shrink-0 self-start">
                    <button
                      type="button"
                      class="flex items-center gap-2 rounded-full bg-base-100/70 px-2 py-1 transition hover:bg-base-100"
                      aria-expanded={maintainerPopoverAddress === repoAddress}
                      aria-label="Show repository maintainers"
                      onclick={() => toggleMaintainerPopover(repoAddress)}>
                      <span class="text-xs font-medium opacity-70">Maintainers</span>
                      <div class="flex -space-x-1.5">
                        {#each maintainerPreview as maintainer (maintainer)}
                          <ProfileCircle
                            pubkey={maintainer}
                            size={5}
                            class="ring-2 ring-base-200" />
                        {/each}
                        {#if hiddenMaintainers > 0}
                          <span
                            class="center h-5 min-w-5 rounded-full bg-base-300 px-1 text-[0.65rem] font-medium ring-2 ring-base-200">
                            +{hiddenMaintainers}
                          </span>
                        {/if}
                      </div>
                    </button>
                    {#if maintainerPopoverAddress === repoAddress}
                      <InlinePopover align="right" widthClass="w-72" onClose={closeMaintainerPopover}>
                        <div class="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
                          Maintainers
                        </div>
                        <div class="flex flex-col gap-1.5">
                          {#each maintainers as maintainer (maintainer)}
                            <div class="flex min-w-0 items-center gap-2 rounded-box p-1.5 hover:bg-base-200/70">
                              <ProfileCircle pubkey={maintainer} size={6} />
                              <ProfileLink
                                pubkey={maintainer}
                                unstyled
                                class="min-w-0 text-sm"
                                beforeOpenProfile={closeMaintainerPopover} />
                            </div>
                          {/each}
                        </div>
                      </InlinePopover>
                    {/if}
                  </div>
                </div>
              </div>
            {:else}
              <div class="rounded-box bg-base-200/60 p-3 text-xs opacity-75 sm:p-4 sm:text-sm">
                {activeRepoEmptyMessage}
              </div>
            {/each}

            {#if filteredActiveRepoEvents.length > REPO_PREVIEW_LIMIT}
              <button
                type="button"
                class="btn btn-neutral btn-xs mx-auto flex sm:btn-sm"
                onclick={toggleActiveRepoExpansion}>
                {activeReposExpanded ? "Show less" : "Show more"}
              </button>
            {/if}
          </div>
        </div>
      </details>

      {#if isSelf}
        <ProfileAdvancedSettings />
      {/if}
    </div>
  {:else}
    <div class="card2 bg-alt mx-auto mt-3 max-w-xl !p-3 shadow-md sm:mt-4 sm:!p-6">
      <h1 class="text-base font-semibold sm:text-xl">Profile not found</h1>
      <p class="mt-2 text-xs opacity-75 sm:text-sm">
        This profile link does not contain a valid npub, nprofile, or hex pubkey.
      </p>
      <Link href="/people" class="btn btn-primary btn-sm mt-3 sm:mt-4">Back to people</Link>
    </div>
  {/if}
</PageContent>
