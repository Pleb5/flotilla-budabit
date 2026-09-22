<script lang="ts">
  import {pubkey, derivePubkeyRelays, repository, tracker} from "@welshman/app"
  import {displayRelayUrl, RelayMode} from "@welshman/util"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import {pushModal} from "@app/util/modal"
  import {
    COMMUNITY_DEFINITION_KIND,
    normalizePubkey,
    parseCommunityDefinition,
    selectCurrentCommunityDefinition,
    type CommunityDefinition,
  } from "@app/core/community"
  import {
    activeCommunityStars,
    activeUserCommunityRefs,
    communityMemberProfileListEvents,
    communityMemberReportStates,
    communityModeratorProfileListEvents,
    communityStarsLoading,
    getCommunityBootstrapRelays,
    hydrateCommunityStars,
    loadCommunityEvents,
  } from "@app/core/community-state"
  import {
    dmRelayRecommendationState,
    dmRelayRecommendations,
    getDmRelayRecommendationSourceLabel,
    loadDmRelayRecommendations,
    type DmRelayRecommendation,
    type DmRelayRecommendationEvidence,
    type DmRelayRecommendationSource,
    type DmRelayRecommendationSourceKind,
  } from "@app/core/dm"
  import type {CommunityStarRef} from "@app/util/community-stars"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"

  const {
    onAdd,
    disabled = false,
    addingRelay = "",
    addLabel = "Add",
  }: {
    onAdd: (url: string) => unknown
    disabled?: boolean
    addingRelay?: string
    addLabel?: string
  } = $props()

  type RecommendationEvidenceGroupKind = "own" | "community" | "moderator" | "member" | "follow"

  type RecommendationEvidenceGroup = {
    kind: RecommendationEvidenceGroupKind
    label: string
    evidence: DmRelayRecommendationEvidence[]
  }

  const RECOMMENDATION_PAGE_SIZE = 10

  const messagingRelayUrls = derivePubkeyRelays($pubkey!, RelayMode.Messaging)

  const loadMoreRecommendations = () => {
    visibleRecommendationCount = Math.min(
      visibleRecommendationCount + RECOMMENDATION_PAGE_SIZE,
      recommendedMessagingRelays.length,
    )
  }

  const openProfile = (pubkey: string) => {
    if (!pubkey || disabled) return

    openRecommendationEvidenceKey = ""
    pushModal(ProfileDetail, {pubkey})
  }

  let recommendedCommunityDefinitions = $state<Record<string, CommunityDefinition>>({})
  let recommendedDefinitionLoadKeys = $state<Record<string, string>>({})
  let recommendedDefinitionLoads = $state<Record<string, boolean>>({})
  let recommendationLoadKey = $state("")
  let recommendationPageKey = $state("")
  let visibleRecommendationCount = $state(RECOMMENDATION_PAGE_SIZE)
  let openRecommendationEvidenceKey = $state("")

  const recommendationState = $derived($dmRelayRecommendationState)
  const recommendedMessagingRelays = $derived($dmRelayRecommendations)
  const visibleRecommendedMessagingRelays = $derived(
    recommendedMessagingRelays.slice(0, visibleRecommendationCount),
  )
  const hasMoreRecommendedMessagingRelays = $derived(
    visibleRecommendedMessagingRelays.length < recommendedMessagingRelays.length,
  )
  const profileListEvents = $derived([
    ...$communityMemberProfileListEvents,
    ...$communityModeratorProfileListEvents,
  ])

  const setRecommendedCommunityDefinition = (
    communityAddress: string,
    definition: CommunityDefinition | undefined,
  ) => {
    if (!definition) return
    const current = recommendedCommunityDefinitions[communityAddress]
    const latest = selectCurrentCommunityDefinition(
      [definition.event, ...(current ? [current.event] : [])],
      communityAddress,
    )
    if (latest?.id !== definition.event.id || current?.event.id === definition.event.id) return

    recommendedCommunityDefinitions = {
      ...recommendedCommunityDefinitions,
      [communityAddress]: definition,
    }
  }

  const loadRecommendedCommunityDefinition = async (star: CommunityStarRef) => {
    const filter = {
      kinds: [COMMUNITY_DEFINITION_KIND],
      authors: [star.community.ownerPubkey],
      "#d": [star.community.communityId],
      limit: 1,
    }
    const selectDefinition = (events: ReturnType<typeof repository.query>) => {
      const event = selectCurrentCommunityDefinition(events, star.community.address)
      return event ? parseCommunityDefinition(event) : undefined
    }
    setRecommendedCommunityDefinition(
      star.community.address,
      selectDefinition(repository.query([filter])),
    )

    const relayHints = Array.from(
      new Set([...star.community.relayHints, ...Array.from(tracker.getRelays(star.reaction.id))]),
    )
    const events = await loadCommunityEvents(getCommunityBootstrapRelays(relayHints), [filter])
    // A relay may return an older definition than the one already in our repository.
    const definition = selectDefinition([...repository.query([filter]), ...events])

    setRecommendedCommunityDefinition(star.community.address, definition)
  }

  const recommendationDefinitionLoading = $derived(
    Object.values(recommendedDefinitionLoads).some(Boolean),
  )
  const currentCommunityRefs = $derived(
    $activeUserCommunityRefs.map(ref => {
      const loaded = recommendedCommunityDefinitions[ref.community.address]
      const event = selectCurrentCommunityDefinition(
        [ref.definition.event, ...(loaded ? [loaded.event] : [])],
        ref.community.address,
      )
      return event?.id === loaded?.event.id ? {...ref, definition: loaded!} : ref
    }),
  )
  const recommendationSources = $derived.by<DmRelayRecommendationSource[]>(() =>
    $activeCommunityStars.flatMap(star => {
      const loaded = recommendedCommunityDefinitions[star.community.address]
      const matchingRef = currentCommunityRefs.find(
        ref => ref.community.address === star.community.address,
      )
      const event = selectCurrentCommunityDefinition(
        [...(loaded ? [loaded.event] : []), ...(matchingRef ? [matchingRef.definition.event] : [])],
        star.community.address,
      )
      const definition = event ? parseCommunityDefinition(event) : undefined
      if (!definition) return []

      const userPubkey = normalizePubkey($pubkey || "")
      const isAdmin = Boolean(userPubkey && userPubkey === definition.ownerPubkey)
      const isModerator = Boolean(
        userPubkey && matchingRef?.roles.some(role => role === "admin" || role === "moderator"),
      )

      return [
        {
          source: "starred_community_relay",
          communityPubkey: star.community.ownerPubkey,
          communityAddress: star.community.address,
          relays: definition.relays,
          primaryRelay: definition.relays[0],
          starredAt: star.reaction.created_at,
          isStarred: true,
          isModerator,
          isAdmin,
        },
      ]
    }),
  )
  const configuredRecommendationCount = $derived(
    recommendedMessagingRelays.filter(recommendation => recommendation.isConfigured).length,
  )
  const recommendationLoading = $derived(
    $communityStarsLoading ||
      recommendationDefinitionLoading ||
      recommendationState.status === "loading",
  )
  const recommendationStatus = $derived.by(() => {
    if (recommendationLoading) {
      return "Checking active communities, starred communities, and messaging relay lists..."
    }

    if (recommendationState.status === "error") {
      return recommendationState.error || "Could not load messaging relay recommendations."
    }

    if (
      recommendedMessagingRelays.length === 0 &&
      $activeUserCommunityRefs.length === 0 &&
      $activeCommunityStars.length === 0
    ) {
      return "Join, moderate, root-admin, or star communities to get community-first DM relay recommendations."
    }

    if (recommendedMessagingRelays.length === 0) {
      return "No usable messaging relay recommendations were found from your trusted community graph yet."
    }

    if (configuredRecommendationCount === recommendedMessagingRelays.length) {
      return "All recommended relays are already configured. They remain listed so you can see why they scored."
    }

    return ""
  })

  const getRecommendationEvidenceKey = (evidence: DmRelayRecommendationEvidence) =>
    `${evidence.source}:${evidence.pubkey || ""}:${evidence.communityAddress || evidence.communityPubkey || ""}`

  const countLabel = (count: number, singular: string, plural = `${singular}s`) =>
    `${count} ${count === 1 ? singular : plural}`

  const uniqueBy = <T,>(items: T[], getKey: (item: T) => string) => {
    const byKey = new Map<string, T>()

    for (const item of items) {
      const key = getKey(item)
      if (key && !byKey.has(key)) byKey.set(key, item)
    }

    return Array.from(byKey.values())
  }

  const communityEvidenceSources = new Set<DmRelayRecommendationSourceKind>([
    "active_community_relay",
    "starred_community_relay",
    "community_messaging",
    "admin_messaging",
  ])

  const getRecommendationEvidenceGroups = (
    recommendation: DmRelayRecommendation,
  ): RecommendationEvidenceGroup[] => {
    const groups: RecommendationEvidenceGroup[] = []
    const ownEvidence = recommendation.evidence.filter(item => item.source === "own_messaging")
    const communityEvidence = uniqueBy(
      recommendation.evidence.filter(item => communityEvidenceSources.has(item.source)),
      item => item.communityAddress || item.communityPubkey || item.pubkey || item.source,
    )
    const moderatorEvidence = uniqueBy(
      recommendation.evidence.filter(item => item.source === "moderator_messaging"),
      item => `${item.pubkey || ""}:${item.communityPubkey || ""}`,
    )
    const memberEvidence = uniqueBy(
      recommendation.evidence.filter(item => item.source === "member_messaging"),
      item => `${item.pubkey || ""}:${item.communityPubkey || ""}`,
    )
    const followEvidence = uniqueBy(
      recommendation.evidence.filter(item => item.source === "follow_messaging"),
      item => item.pubkey || "",
    )

    if (ownEvidence.length > 0) {
      groups.push({kind: "own", label: "Your DM list", evidence: ownEvidence})
    }
    if (communityEvidence.length > 0) {
      groups.push({
        kind: "community",
        label: countLabel(communityEvidence.length, "Community", "Communities"),
        evidence: communityEvidence,
      })
    }
    if (moderatorEvidence.length > 0) {
      groups.push({
        kind: "moderator",
        label: countLabel(moderatorEvidence.length, "Moderator"),
        evidence: moderatorEvidence,
      })
    }
    if (memberEvidence.length > 0) {
      groups.push({
        kind: "member",
        label: countLabel(memberEvidence.length, "Member"),
        evidence: memberEvidence,
      })
    }
    if (followEvidence.length > 0) {
      groups.push({
        kind: "follow",
        label: countLabel(followEvidence.length, "Follow"),
        evidence: followEvidence,
      })
    }

    return groups
  }

  const getRecommendationEvidenceProfilePubkey = (evidence: DmRelayRecommendationEvidence) =>
    communityEvidenceSources.has(evidence.source)
      ? evidence.communityPubkey || evidence.pubkey || ""
      : evidence.pubkey || evidence.communityPubkey || ""

  const getRecommendationEvidenceCommunityPubkey = (evidence: DmRelayRecommendationEvidence) => {
    const profilePubkey = getRecommendationEvidenceProfilePubkey(evidence)

    return evidence.communityPubkey && evidence.communityPubkey !== profilePubkey
      ? evidence.communityPubkey
      : ""
  }

  const getRecommendationEvidenceRoleLabel = (evidence: DmRelayRecommendationEvidence) => {
    if (evidence.source === "own_messaging") return "From your messaging relay list"
    if (evidence.source === "follow_messaging") return "You follow this person"

    return getDmRelayRecommendationSourceLabel(evidence.source)
  }

  const getRecommendationGroupPopoverKey = (
    recommendation: DmRelayRecommendation,
    group: RecommendationEvidenceGroup,
  ) => `${recommendation.url}:${group.kind}`

  $effect(() => {
    if (!$pubkey) return

    hydrateCommunityStars().catch(() => {})
  })

  $effect(() => {
    if (!$pubkey) return

    for (const star of $activeCommunityStars) {
      const loadKey = `${star.community.address}:${star.community.relayHints.join(",")}`

      if (recommendedDefinitionLoadKeys[star.community.address] === loadKey) continue
      if (recommendedDefinitionLoads[star.community.address]) continue

      recommendedDefinitionLoadKeys = {
        ...recommendedDefinitionLoadKeys,
        [star.community.address]: loadKey,
      }
      recommendedDefinitionLoads = {
        ...recommendedDefinitionLoads,
        [star.community.address]: true,
      }

      loadRecommendedCommunityDefinition(star)
        .catch(() => undefined)
        .finally(() => {
          recommendedDefinitionLoads = {
            ...recommendedDefinitionLoads,
            [star.community.address]: false,
          }
        })
    }
  })

  $effect(() => {
    if (!$pubkey) return

    const key = JSON.stringify({
      pubkey: $pubkey,
      currentRelays: $messagingRelayUrls,
      communities: currentCommunityRefs.map(
        ref => `${ref.community.address}:${ref.definition.event.id}:${ref.roles.join(",")}`,
      ),
      profileLists: profileListEvents.map(event => `${event.id}:${event.created_at}`),
      reports: Array.from($communityMemberReportStates.entries()).map(([community, state]) => [
        community,
        state.personReports.length,
        state.eventReports.length,
      ]),
      starredCommunities: $activeCommunityStars.map(
        star => `${star.community.address}:${star.reaction.created_at}`,
      ),
      starSources: recommendationSources.map(
        source => `${source.communityPubkey}:${source.starredAt || 0}:${source.relays.join(",")}`,
      ),
    })

    if (key === recommendationLoadKey) return

    recommendationLoadKey = key
    loadDmRelayRecommendations({
      currentRelays: $messagingRelayUrls,
      communityRefs: currentCommunityRefs,
      profileListEvents,
      reportStates: $communityMemberReportStates,
      extraSources: recommendationSources,
      starredCommunityPubkeys: $activeCommunityStars.map(star => star.community.ownerPubkey),
    }).catch(() => undefined)
  })

  $effect(() => {
    const key = recommendedMessagingRelays.map(recommendation => recommendation.url).join("\n")

    if (key === recommendationPageKey) return

    recommendationPageKey = key
    visibleRecommendationCount = RECOMMENDATION_PAGE_SIZE
    openRecommendationEvidenceKey = ""
  })
</script>

{#if $pubkey}
  <div class="rounded-box border border-base-300 bg-base-100 p-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase tracking-wide opacity-60">
          Recommended messaging relays
        </p>
        {#if recommendationStatus}
          <p class="mt-1 text-sm opacity-70">{recommendationStatus}</p>
        {/if}
      </div>
      {#if recommendationLoading}
        <span class="loading loading-spinner loading-xs shrink-0 opacity-60"></span>
      {/if}
    </div>

    {#if recommendedMessagingRelays.length > 0}
      <div class="column mt-3 gap-2">
        {#each visibleRecommendedMessagingRelays as recommendation (recommendation.url)}
          {@const evidenceGroups = getRecommendationEvidenceGroups(recommendation)}
          <div class="rounded-box border border-base-300 bg-base-200/50 p-3">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <p class="ellipsize font-medium">{displayRelayUrl(recommendation.url)}</p>
                  {#if recommendation.isConfigured}
                    <span class="badge badge-success badge-sm">Configured</span>
                  {/if}
                </div>
                <p class="mt-1 text-xs opacity-70">
                  {#if recommendation.evidence.some(source => source.isPrimary)}
                    Primary relay from a current community definition
                  {:else}
                    Community and messaging-list signals
                  {/if}
                </p>
              </div>
              {#if recommendation.isConfigured}
                <span class="badge badge-success shrink-0 self-start">Already added</span>
              {:else}
                <Button
                  class="btn btn-outline btn-sm shrink-0"
                  {disabled}
                  onclick={() => onAdd(recommendation.url)}>
                  <Icon icon={AddCircle} />
                  {addingRelay === recommendation.url ? "Saving..." : addLabel}
                </Button>
              {/if}
            </div>

            <div class="mt-3 flex flex-wrap gap-1.5">
              {#each evidenceGroups as group (group.kind)}
                {@const popoverKey = getRecommendationGroupPopoverKey(recommendation, group)}
                <div class="relative">
                  <button
                    type="button"
                    class="badge cursor-pointer border border-base-content/15 bg-base-200 font-medium text-base-content/80 hover:bg-base-300"
                    class:bg-base-300={openRecommendationEvidenceKey === popoverKey}
                    aria-expanded={openRecommendationEvidenceKey === popoverKey}
                    onclick={() =>
                      (openRecommendationEvidenceKey =
                        openRecommendationEvidenceKey === popoverKey ? "" : popoverKey)}>
                    {group.label}
                  </button>

                  {#if openRecommendationEvidenceKey === popoverKey}
                    <InlinePopover
                      align="left"
                      widthClass="w-80 sm:w-96"
                      onClose={() => (openRecommendationEvidenceKey = "")}>
                      <div class="flex min-w-0 flex-col gap-3 text-sm">
                        <div>
                          <p class="text-xs font-semibold uppercase tracking-wide opacity-60">
                            {group.label}
                          </p>
                          <p class="mt-1 break-all font-mono text-[11px] opacity-60">
                            {displayRelayUrl(recommendation.url)}
                          </p>
                        </div>

                        <div class="flex flex-col gap-2">
                          {#each group.evidence as source (getRecommendationEvidenceKey(source))}
                            {@const profilePubkey = getRecommendationEvidenceProfilePubkey(source)}
                            {@const communityPubkey =
                              getRecommendationEvidenceCommunityPubkey(source)}
                            {@const roleLabel = getRecommendationEvidenceRoleLabel(source)}
                            {@const sourceLabel = getDmRelayRecommendationSourceLabel(
                              source.source,
                            )}
                            <div class="rounded-box bg-base-200/60 p-3">
                              <div class="flex min-w-0 items-center gap-2">
                                {#if profilePubkey}
                                  <button
                                    type="button"
                                    class="shrink-0"
                                    aria-label="Open profile"
                                    onclick={() => openProfile(profilePubkey)}>
                                    <ProfileCircle pubkey={profilePubkey} size={7} />
                                  </button>
                                {/if}
                                <div class="min-w-0 flex-1">
                                  {#if profilePubkey}
                                    <button
                                      type="button"
                                      class="max-w-full truncate text-sm font-medium hover:underline"
                                      onclick={() => openProfile(profilePubkey)}>
                                      <ProfileName pubkey={profilePubkey} />
                                    </button>
                                  {:else}
                                    <p class="truncate text-sm font-medium">{sourceLabel}</p>
                                  {/if}
                                  <div class="text-xs opacity-70">{roleLabel}</div>
                                  {#if communityPubkey}
                                    <button
                                      type="button"
                                      class="max-w-full truncate text-left text-[11px] opacity-60 hover:underline"
                                      onclick={() => openProfile(communityPubkey)}>
                                      in <ProfileName pubkey={communityPubkey} />
                                    </button>
                                  {/if}
                                </div>
                              </div>
                            </div>
                          {/each}
                        </div>
                      </div>
                    </InlinePopover>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}
        {#if hasMoreRecommendedMessagingRelays}
          <div class="mt-2 flex flex-col items-center gap-2 pb-1">
            <Button class="btn btn-outline btn-sm" onclick={loadMoreRecommendations}>
              Load more
            </Button>
            <p class="text-xs opacity-60">
              Showing {visibleRecommendedMessagingRelays.length} of {recommendedMessagingRelays.length}
            </p>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
