<script module lang="ts">
  import {DELETE, type Filter, type TrustedEvent as ModuleTrustedEvent} from "@welshman/util"

  const loadedFilterRequests = new Map<string, Promise<boolean>>()

  const getDeletedTargetEventIds = (
    targetEvents: ModuleTrustedEvent[],
    deleteEvents: ModuleTrustedEvent[],
  ) => {
    const targetsById = new Map(targetEvents.map(event => [event.id, event]))
    const deletedIds = new Set<string>()

    for (const event of deleteEvents) {
      if (event.kind !== DELETE) continue

      for (const tag of event.tags || []) {
        if (tag[0] !== "e" || !tag[1]) continue

        const target = targetsById.get(tag[1])
        if (target?.pubkey === event.pubkey) deletedIds.add(tag[1])
      }
    }

    return deletedIds
  }

  const getLoadKey = (
    relays: string[],
    relayFilters: Filter[],
    localFilters: Filter[],
    label: string,
  ) =>
    `${label}:${relays.slice().sort().join(",")}:${[...relayFilters, ...localFilters]
      .map(filter => JSON.stringify(filter))
      .join("|")}`
</script>

<script lang="ts">
  import {PublishStatus} from "@welshman/net"
  import {Router} from "@welshman/router"
  import {
    getTagValue,
    isRelayUrl,
    makeEvent,
    normalizeRelayUrl,
    REACTION,
    type TrustedEvent,
  } from "@welshman/util"
  import {randomId} from "@welshman/lib"
  import {deriveEventsById, deriveEventsDesc} from "@welshman/store"
  import {profilesByPubkey, pubkey, publishThunk, repository} from "@welshman/app"
  import type {RepoCommunityOption} from "@nostr-git/ui"
  import type {RepoAnnouncementEvent} from "@nostr-git/core/events"
  import {Star} from "@lucide/svelte"
  import RepoCollectModal from "@app/components/RepoCollectModal.svelte"
  import LogIn from "@app/components/LogIn.svelte"
  import {publishDelete} from "@app/core/commands"
  import {activeUserCommunityRefs, hydratePreferredCommunities} from "@app/core/community-state"
  import {
    TARGETED_PUBLICATION_KIND,
    makeCommunityPointer,
    parseTargetedPublication,
  } from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    communityWritableSectionsSupportTarget,
  } from "@app/core/community-permissions"
  import {
    makeCommunityContentFilterPlan,
    makeTargetedPublicationOriginalFilterPlan,
  } from "@app/core/community-feeds"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {loadBoundedCommunityHistory, makeSameAuthorDeleteFilters} from "@app/core/requests"
  import {
    makeEventPublicationRef,
    makeTargetedPublicationForCommunity,
    withPublicationTargetingId,
  } from "@app/core/community-targeting"
  import {GIT_RELAYS, getRepoScopedRelays} from "@app/core/git-state"
  import {publishEvent} from "@app/core/git-commands"
  import {activeRepoStars, hydrateRepoStars} from "@app/core/repo-stars-state"
  import {
    getCanonicalRepoKeyFromEvent,
    getRepoAddressFromEvent,
    isAnyBookmarked,
  } from "@app/util/bookmarks"
  import {makeRepoStarReaction, repoStarToBookmarkAddress} from "@app/util/repo-stars"
  import {clearModals, pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {
    buildRepoCommunityStarCollections,
    getRepoCollectionStatus,
    type RepoCollectionCommunityStar,
    type RepoCollectionReadState,
  } from "@app/core/repo-collection-read-model"

  type PublishThunkResult = {
    event?: TrustedEvent
    complete?: Promise<unknown>
    results?: Record<string, {status?: unknown}>
  }

  type Props = {
    event: TrustedEvent
    relayHint?: string
    relayHints?: string[]
    class?: string
    iconClass?: string
    disabled?: boolean
    showLabel?: boolean
    collectionState?: RepoCollectionReadState
  }

  const {
    event,
    relayHint = "",
    relayHints = [],
    class:
      className = "rounded-full border border-border bg-background/80 p-1.5 text-muted-foreground transition-colors hover:text-foreground",
    iconClass = "h-4 w-4",
    disabled = false,
    showLabel = false,
    collectionState,
  }: Props = $props()

  let pending = $state(false)
  let localTargetHistoryComplete = $state(false)
  let localDeleteHistoryComplete = $state(false)
  let localOriginalHistoryComplete = $state(false)
  let localTargetHistoryRequestId = 0
  let localDeleteHistoryRequestId = 0
  let localOriginalHistoryRequestId = 0

  const repoEvent = $derived(event as RepoAnnouncementEvent)

  const normalizeRelay = (relay?: string) => {
    if (!relay) return ""

    try {
      const normalized = normalizeRelayUrl(relay)
      return isRelayUrl(normalized) ? normalized : ""
    } catch {
      return ""
    }
  }

  const normalizeRelays = (relays: string[]) =>
    Array.from(new Set(relays.map(normalizeRelay).filter(Boolean)))

  const getUserOutboxRelays = () => {
    try {
      return Router.get().FromUser().getUrls() || []
    } catch {
      return []
    }
  }

  const getEventRelayHint = () =>
    relayHint ||
    Router.get().getRelaysForPubkey(repoEvent.pubkey)?.[0] ||
    getTagValue("relays", repoEvent.tags || []) ||
    relayHints[0] ||
    ""

  const repoAddress = $derived(getRepoAddressFromEvent(repoEvent))
  const eventRelayHint = $derived(getEventRelayHint())
  const collectionRelays = $derived(
    normalizeRelays([eventRelayHint, ...relayHints, ...getUserOutboxRelays(), ...GIT_RELAYS]),
  )
  const repoPublishRelays = $derived.by(() => getRepoScopedRelays(repoEvent))
  const candidateAddresses = $derived(new Set(repoAddress ? [repoAddress] : []))
  const candidateRepoKeys = $derived.by(() => {
    const key = getCanonicalRepoKeyFromEvent(repoEvent)
    return key ? [key] : []
  })

  const getCommunityOptionLabel = (communityPubkey: string) => {
    const profile = $profilesByPubkey.get(communityPubkey)
    return (
      profile?.display_name ||
      profile?.name ||
      `${communityPubkey.slice(0, 8)}...${communityPubkey.slice(-6)}`
    )
  }

  const repoStarCommunityOptions = $derived.by(
    (): RepoCommunityOption[] =>
      collectionState?.communityOptions ||
      $activeUserCommunityRefs
        .filter(ref =>
          communityWritableSectionsSupportTarget({
            definition: ref.definition,
            writableSections: ref.writableSections,
            target: COMMUNITY_WRITE_TARGETS.reaction,
          }),
        )
        .map(ref => ({
          ownerPubkey: ref.community.ownerPubkey,
          address: ref.community.address,
          communityId: ref.community.communityId,
          label: ref.definition.metadata.name,
          relays: ref.definition.relays,
        })),
  )
  const repoStarCommunityRelays = $derived(
    normalizeRelays([
      ...repoStarCommunityOptions.flatMap(option => [option.relay || "", ...(option.relays || [])]),
      ...collectionRelays,
    ]),
  )

  const userCommunityStarTargetFilterPlan = $derived.by(() => {
    if (collectionState) return {relayFilters: [], localFilters: []}
    if (!$pubkey || repoStarCommunityOptions.length === 0) {
      return {relayFilters: [], localFilters: []}
    }

    const communityIds = Array.from(
      new Set(repoStarCommunityOptions.map(option => option.communityId).filter(Boolean)),
    )
    if (communityIds.length === 0) return {relayFilters: [], localFilters: []}

    return makeCommunityContentFilterPlan(
      [
        {
          kinds: [TARGETED_PUBLICATION_KIND],
          "#h": communityIds,
          "#k": [String(REACTION)],
        } as Filter,
      ],
      [$pubkey],
    )
  })
  const userCommunityStarTargetFilters = $derived(userCommunityStarTargetFilterPlan.localFilters)
  const userCommunityStarTargetEvents = $derived.by(() =>
    userCommunityStarTargetFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: userCommunityStarTargetFilters as any}),
        )
      : undefined,
  )
  const userCommunityStarTargetDeleteFilters = $derived.by(() =>
    makeSameAuthorDeleteFilters(
      $userCommunityStarTargetEvents ? ($userCommunityStarTargetEvents as TrustedEvent[]) : [],
    ),
  )
  const userCommunityStarTargetDeleteEvents = $derived.by(() =>
    userCommunityStarTargetDeleteFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: userCommunityStarTargetDeleteFilters as any}),
        )
      : undefined,
  )
  const deletedUserCommunityStarTargetIds = $derived.by(() =>
    getDeletedTargetEventIds(
      $userCommunityStarTargetEvents ? ($userCommunityStarTargetEvents as TrustedEvent[]) : [],
      $userCommunityStarTargetDeleteEvents
        ? ($userCommunityStarTargetDeleteEvents as TrustedEvent[])
        : [],
    ),
  )
  const eligibleUserCommunityStarTargetEvents = $derived.by(() => {
    if (!$pubkey || !$userCommunityStarTargetEvents) return []

    return ($userCommunityStarTargetEvents as TrustedEvent[]).filter(
      event => event.pubkey === $pubkey && !deletedUserCommunityStarTargetIds.has(event.id),
    )
  })
  const userCommunityStarReactionFilterPlan = $derived.by(() =>
    $pubkey && eligibleUserCommunityStarTargetEvents.length
      ? makeTargetedPublicationOriginalFilterPlan(eligibleUserCommunityStarTargetEvents)
      : {relayFilters: [], localFilters: []},
  )
  const userCommunityStarReactionFilters = $derived(
    userCommunityStarReactionFilterPlan.localFilters,
  )
  const userCommunityStarReactionRelays = $derived(
    normalizeRelays([
      ...repoStarCommunityRelays,
      ...eligibleUserCommunityStarTargetEvents.flatMap(event => {
        const relay = parseTargetedPublication(event)?.source?.relay
        return relay ? [relay] : []
      }),
    ]),
  )
  const userCommunityStarReactionEvents = $derived.by(() =>
    userCommunityStarReactionFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: userCommunityStarReactionFilters as any}),
        )
      : undefined,
  )

  const activeUserAllCommunityRepoStarCollections = $derived.by(
    (): RepoCollectionCommunityStar[] =>
      collectionState?.communityStars ||
      buildRepoCommunityStarCollections({
        viewerPubkey: $pubkey || "",
        communityOptions: repoStarCommunityOptions,
        targetEvents: $userCommunityStarTargetEvents
          ? ($userCommunityStarTargetEvents as TrustedEvent[])
          : [],
        targetDeleteEvents: $userCommunityStarTargetDeleteEvents
          ? ($userCommunityStarTargetDeleteEvents as TrustedEvent[])
          : [],
        reactionEvents: $userCommunityStarReactionEvents
          ? ($userCommunityStarReactionEvents as TrustedEvent[])
          : [],
      }),
  )

  const existingPersonalStar = $derived.by(() =>
    (collectionState?.personalStars || $activeRepoStars).find(star =>
      isAnyBookmarked([repoStarToBookmarkAddress(star)], candidateAddresses, {
        candidateRepoKeys,
        getCachedEvent: address =>
          repository.getEvent(address) as RepoAnnouncementEvent | undefined,
      }),
    ),
  )
  const existingCommunityStars = $derived.by(() =>
    activeUserAllCommunityRepoStarCollections.filter(collection =>
      isAnyBookmarked([repoStarToBookmarkAddress(collection.star)], candidateAddresses, {
        candidateRepoKeys,
        getCachedEvent: address =>
          repository.getEvent(address) as RepoAnnouncementEvent | undefined,
      }),
    ),
  )
  const collected = $derived(Boolean(existingPersonalStar || existingCommunityStars.length > 0))
  const communityHistoryComplete = $derived(
    !$pubkey ||
      (collectionState?.communityHistoryComplete ??
        (localTargetHistoryComplete && localDeleteHistoryComplete && localOriginalHistoryComplete)),
  )
  const collectionStatus = $derived(getRepoCollectionStatus(collected, communityHistoryComplete))
  const collectionLabel = $derived.by(() => {
    if (!communityHistoryComplete) {
      return "Manage repository collections"
    }

    return collected ? "Edit repository collections" : "Collect repository"
  })

  const getPublishThunkSucceeded = (thunk?: PublishThunkResult) => {
    if (!thunk) return false

    const results = Object.values(thunk.results || {})
    if (results.length === 0) return Boolean(thunk.event)

    return results.some(result => result?.status === PublishStatus.Success)
  }

  const awaitPublishThunks = async (
    thunks: Array<PublishThunkResult | undefined>,
    mode: "all" | "any" = "any",
  ) => {
    const publishThunks = thunks.filter(Boolean) as PublishThunkResult[]
    if (publishThunks.length === 0) return false

    await Promise.allSettled(publishThunks.map(thunk => thunk.complete || Promise.resolve()))

    const successes = publishThunks.map(getPublishThunkSucceeded)
    return mode === "all" ? successes.every(Boolean) : successes.some(Boolean)
  }

  const getRepoCollectionCommunityLabel = (community: RepoCommunityOption) =>
    community.label || getCommunityOptionLabel(community.ownerPubkey)

  const getDeclaredCommunityRelays = (community: RepoCommunityOption | undefined) =>
    normalizeRelays([community?.relay || "", ...(community?.relays || [])])

  const requireDeclaredCommunityRelays = (community: RepoCommunityOption) => {
    const relays = getDeclaredCommunityRelays(community)

    if (relays.length === 0) {
      throw new Error(
        `${getRepoCollectionCommunityLabel(community)} must declare relays before publishing.`,
      )
    }

    return relays
  }

  const publishPersonalRepoStar = ({createdAt}: {createdAt: number}) => {
    const relays = normalizeRelays(repoPublishRelays)
    const starEvent = {
      ...makeRepoStarReaction({
        event: repoEvent,
        address: repoAddress,
        relayHints: eventRelayHint ? [eventRelayHint] : [],
      }),
      created_at: createdAt,
    }
    const thunk = publishEvent(starEvent as any, relays, repoAddress)

    if (thunk?.event) repository.publish(thunk.event as TrustedEvent)

    return thunk as PublishThunkResult | undefined
  }

  const publishCommunityRepoStar = ({
    community,
    createdAt,
  }: {
    community: RepoCommunityOption
    createdAt: number
  }) => {
    const targetingId = randomId()
    const communityRelays = requireDeclaredCommunityRelays(community)
    const communityPointer = makeCommunityPointer({
      ownerPubkey: community.ownerPubkey,
      communityId: community.communityId || "",
      relayHints: communityRelays,
    })
    if (!communityPointer || communityPointer.address !== community.address) {
      throw new Error("Selected community is unavailable.")
    }
    const relays = normalizeRelays(repoPublishRelays)
    const starEvent = withPublicationTargetingId(
      {
        ...makeRepoStarReaction({
          event: repoEvent,
          address: repoAddress,
          relayHints: eventRelayHint ? [eventRelayHint] : [],
        }),
        created_at: createdAt,
      },
      targetingId,
    )
    const starThunk = publishEvent(starEvent as any, relays, repoAddress)
    if (starThunk?.event) repository.publish(starThunk.event as TrustedEvent)

    const targetingEvent = makeEvent(TARGETED_PUBLICATION_KIND, {
      ...makeTargetedPublicationForCommunity({
        targetingId,
        originalKind: REACTION,
        originalRef: starThunk?.event?.id
          ? makeEventPublicationRef({
              id: starThunk.event.id,
              relay: relays[0],
              pubkey: starThunk.event.pubkey,
            })
          : undefined,
        community: communityPointer,
      }),
      created_at: createdAt + 1,
    })
    const targetingThunk = publishThunk({event: targetingEvent, relays: communityRelays})
    if (targetingThunk?.event) repository.publish(targetingThunk.event as TrustedEvent)

    return [starThunk, targetingThunk] as Array<PublishThunkResult | undefined>
  }

  const deleteCommunityRepoStar = ({
    collection,
    community,
  }: {
    collection: RepoCollectionCommunityStar
    community?: RepoCommunityOption
  }) => {
    const communityRelays = requireDeclaredCommunityRelays(community || collection.community)
    const relays = normalizeRelays(repoPublishRelays)
    const targetDelete = publishDelete({
      event: collection.targetEvent,
      relays: communityRelays,
    })
    if (targetDelete?.event) repository.publish(targetDelete.event as TrustedEvent)

    const starDelete = publishDelete({event: collection.star.reaction, relays, repoAddress})
    if (starDelete?.event) repository.publish(starDelete.event as TrustedEvent)

    return [targetDelete, starDelete] as Array<PublishThunkResult | undefined>
  }

  const loadFilters = (
    label: string,
    relays: string[],
    relayFilters: Filter[],
    localFilters = relayFilters,
  ): Promise<boolean> => {
    if (relayFilters.length === 0 || localFilters.length === 0) return Promise.resolve(true)
    if (relays.length === 0) return Promise.resolve(false)

    const key = getLoadKey(relays, relayFilters, localFilters, label)
    const existing = loadedFilterRequests.get(key)
    if (existing) return existing

    const request = loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters,
      priority: RELAY_REQUEST_PRIORITY.background,
      owner: `repo-collect:${label}`,
    })
      .then(result => result.complete)
      .catch(error => {
        console.warn(`[repo-collect] Failed to load ${label}`, error)
        return false
      })
      .finally(() => {
        if (loadedFilterRequests.get(key) === request) loadedFilterRequests.delete(key)
      })

    loadedFilterRequests.set(key, request)
    return request
  }

  const openCollectModal = () => {
    if (!$pubkey) {
      pushModal(LogIn)
      return
    }

    if (!repoAddress || pending) return

    const personalStar = existingPersonalStar
    const communityStars = existingCommunityStars
    const existingCommunityByAddress = new Map(
      communityStars.map(collection => [collection.community.address, collection]),
    )
    const communityOptions = [...repoStarCommunityOptions]
    const communityHistoryCompleteAtOpen = communityHistoryComplete

    for (const collection of communityStars) {
      if (!communityOptions.some(option => option.address === collection.community.address)) {
        communityOptions.push(collection.community)
      }
    }

    pushModal(RepoCollectModal, {
      title: "Edit collections",
      description: communityHistoryCompleteAtOpen
        ? "Choose where this repository should be starred or curated."
        : "Community collection history is still loading. Community selections cannot be changed right now.",
      submitLabel: "Update",
      submittingLabel: "editing collections...",
      communityOptions,
      allowEmpty: true,
      requireChanges: true,
      defaultPersonal: Boolean(personalStar),
      defaultCommunityAddresses: Array.from(existingCommunityByAddress.keys()).filter(Boolean),
      lockedCommunityAddresses: communityHistoryCompleteAtOpen
        ? []
        : communityOptions.map(option => option.address).filter(Boolean),
      onCancel: clearModals,
      onCollect: async ({
        personal,
        communityAddresses,
      }: {
        personal: boolean
        communityAddresses: string[]
      }) => {
        if (pending) return

        pending = true
        try {
          const baseCreatedAt = Math.floor(Date.now() / 1000)
          const selectedCommunityAddresses = new Set(communityAddresses)
          if (
            !communityHistoryCompleteAtOpen &&
            communityStars.some(
              collection => !selectedCommunityAddresses.has(collection.community.address || ""),
            )
          ) {
            pushToast({
              message: "Known community collections cannot be removed right now.",
              theme: "error",
            })
            return
          }
          const actions: Array<{
            thunks: Array<PublishThunkResult | undefined>
            mode: "all" | "any"
            failureMessage: string
          }> = []

          if (personalStar && !personal) {
            const relays = normalizeRelays(repoPublishRelays)
            const thunk = publishDelete({event: personalStar.reaction, relays, repoAddress})
            if (thunk?.event) repository.publish(thunk.event as TrustedEvent)
            actions.push({
              thunks: [thunk as PublishThunkResult | undefined],
              mode: "any",
              failureMessage: "failed to remove personal star",
            })
          } else if (!personalStar && personal) {
            actions.push({
              thunks: [publishPersonalRepoStar({createdAt: baseCreatedAt})],
              mode: "any",
              failureMessage: "failed to collect personally",
            })
          }

          for (const collection of communityStars) {
            if (selectedCommunityAddresses.has(collection.community.address || "")) continue

            actions.push({
              thunks: deleteCommunityRepoStar({collection, community: collection.community}),
              mode: "all",
              failureMessage: `failed to remove from ${getRepoCollectionCommunityLabel(collection.community)}`,
            })
          }

          for (const [index, communityAddress] of communityAddresses.entries()) {
            if (existingCommunityByAddress.has(communityAddress)) continue

            const community = repoStarCommunityOptions.find(
              option => option.address === communityAddress,
            )
            if (!community) continue

            actions.push({
              thunks: publishCommunityRepoStar({
                community,
                createdAt: baseCreatedAt + 2 + index * 2,
              }),
              mode: "all",
              failureMessage: `failed to collect into ${getRepoCollectionCommunityLabel(community)}`,
            })
          }

          const results = await Promise.all(
            actions.map(async action => ({
              action,
              succeeded: await awaitPublishThunks(action.thunks, action.mode),
            })),
          )
          const failures = results.filter(result => !result.succeeded)

          for (const failure of failures) {
            pushToast({message: failure.action.failureMessage, theme: "error"})
          }

          clearModals()
          if (actions.length > 0 && failures.length === 0) {
            pushToast({message: "Repository collections updated"})
          }
        } catch (error) {
          console.error("[repo-collect] Failed to edit repository collections", error)
          pushToast({
            message:
              error instanceof Error ? error.message : "Failed to edit repository collections",
            theme: "error",
          })
        } finally {
          pending = false
        }
      },
    })
  }

  $effect(() => {
    if (collectionState) return
    if (!$pubkey) return

    hydratePreferredCommunities({relayHints: collectionRelays}).catch(error => {
      console.warn("[repo-collect] Failed to hydrate preferred communities", error)
    })
  })

  $effect(() => {
    if (collectionState) return
    if (!$pubkey || !repoAddress) return

    hydrateRepoStars({relayHints: collectionRelays, repoAddress}).catch(error => {
      console.warn("[repo-collect] Failed to hydrate repo stars", error)
    })
  })

  $effect(() => {
    if (collectionState) {
      localTargetHistoryRequestId += 1
      return
    }

    const requestId = ++localTargetHistoryRequestId
    localTargetHistoryComplete = false
    void loadFilters(
      "community star targets",
      repoStarCommunityRelays,
      userCommunityStarTargetFilterPlan.relayFilters,
      userCommunityStarTargetFilterPlan.localFilters,
    ).then(complete => {
      if (requestId === localTargetHistoryRequestId) localTargetHistoryComplete = complete
    })
  })
  $effect(() => {
    if (collectionState) {
      localDeleteHistoryRequestId += 1
      return
    }

    const requestId = ++localDeleteHistoryRequestId
    localDeleteHistoryComplete = false
    void loadFilters(
      "community star target deletes",
      repoStarCommunityRelays,
      userCommunityStarTargetDeleteFilters,
    ).then(complete => {
      if (requestId === localDeleteHistoryRequestId) localDeleteHistoryComplete = complete
    })
  })
  $effect(() => {
    if (collectionState) {
      localOriginalHistoryRequestId += 1
      return
    }

    const requestId = ++localOriginalHistoryRequestId
    localOriginalHistoryComplete = false
    void loadFilters(
      "community star reactions",
      userCommunityStarReactionRelays,
      userCommunityStarReactionFilterPlan.relayFilters,
      userCommunityStarReactionFilterPlan.localFilters,
    ).then(complete => {
      if (requestId === localOriginalHistoryRequestId) localOriginalHistoryComplete = complete
    })
  })
</script>

<button
  type="button"
  class={`${className} ${collectionStatus === "collected" ? "border-amber-400/60 bg-amber-400/10 text-amber-600 dark:text-amber-400" : collectionStatus === "indeterminate" ? "border-dashed border-amber-400/60 text-amber-600 dark:text-amber-400" : ""}`}
  aria-label={collectionLabel}
  title={collectionLabel}
  data-collection-status={collectionStatus}
  disabled={disabled || pending}
  onclick={openCollectModal}>
  <span class="relative inline-flex">
    <Star class={`${iconClass} ${collected ? "fill-current" : ""}`} />
    {#if collectionStatus === "indeterminate"}
      <span class="absolute -right-1 -top-1 text-[10px] font-bold leading-none" aria-hidden="true"
        >?</span>
    {/if}
  </span>
  {#if showLabel}{collected ? "Starred" : "Star"}{/if}
</button>
