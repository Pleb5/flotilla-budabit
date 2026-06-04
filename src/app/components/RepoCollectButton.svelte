<script module lang="ts">
  import {DELETE, type Filter, type TrustedEvent as ModuleTrustedEvent} from "@welshman/util"

  const loadedFilterKeys = new Set<string>()

  const makeTargetDeleteFilters = (events: ModuleTrustedEvent[]): Filter[] => {
    const ids = Array.from(new Set(events.map(event => event.id).filter(Boolean)))
    return ids.length ? [{kinds: [DELETE], "#e": ids, limit: ids.length}] : []
  }

  const getDeletedTargetEventIds = (targetEvents: ModuleTrustedEvent[], deleteEvents: ModuleTrustedEvent[]) => {
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

  const getLoadKey = (relays: string[], filters: Filter[], label: string) =>
    `${label}:${relays.slice().sort().join(",")}:${filters.map(filter => JSON.stringify(filter)).join("|")}`
</script>

<script lang="ts">
  import {load, PublishStatus} from "@welshman/net"
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
  import {
    activeUserCommunityRefs,
    hydratePreferredCommunities,
  } from "@app/core/community-state"
  import {TARGETED_PUBLICATION_KIND, parseTargetedPublication} from "@app/core/community"
  import {COMMUNITY_WRITE_TARGETS, communityWritableSectionsSupportTarget} from "@app/core/community-permissions"
  import {makeTargetedPublicationOriginalFilters} from "@app/core/community-feeds"
  import {
    getPublicationTargetingId,
    makeTargetedPublicationForCommunity,
    withPublicationTargetingId,
  } from "@app/core/community-targeting"
  import {GIT_RELAYS} from "@app/core/git-state"
  import {activeRepoStars, getRepoStarRelays, hydrateRepoStars} from "@app/core/repo-stars-state"
  import {
    getCanonicalRepoKeyFromEvent,
    getRepoAddressFromEvent,
    isAnyBookmarked,
  } from "@app/util/bookmarks"
  import {
    makeRepoStarReaction,
    parseRepoStarReaction,
    repoStarToBookmarkAddress,
    type RepoStarRef,
  } from "@app/util/repo-stars"
  import {clearModals, pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"

  type RepoCollectionCommunityStar = {
    targetEvent: TrustedEvent
    star: RepoStarRef
    community: RepoCommunityOption
  }

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
  }

  const {
    event,
    relayHint = "",
    relayHints = [],
    class: className = "rounded-full border border-border bg-background/80 p-1.5 text-muted-foreground transition-colors hover:text-foreground",
    iconClass = "h-4 w-4",
    disabled = false,
  }: Props = $props()

  let pending = $state(false)

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

  const repoStarCommunityOptions = $derived.by((): RepoCommunityOption[] =>
    $activeUserCommunityRefs
      .filter(ref =>
        communityWritableSectionsSupportTarget({
          definition: ref.definition,
          writableSections: ref.writableSections,
          target: COMMUNITY_WRITE_TARGETS.reaction,
        }),
      )
      .map(ref => ({
        pubkey: ref.communityPubkey,
        label: getCommunityOptionLabel(ref.communityPubkey),
        relays: ref.relayHints.length ? ref.relayHints : ref.definition.relays,
      })),
  )
  const repoStarCommunityRelays = $derived(
    normalizeRelays([
      ...repoStarCommunityOptions.flatMap(option => [option.relay || "", ...(option.relays || [])]),
      ...collectionRelays,
    ]),
  )

  const userCommunityStarTargetFilters = $derived.by((): Filter[] => {
    if (!$pubkey || repoStarCommunityOptions.length === 0) return []

    const communityPubkeys = Array.from(
      new Set(repoStarCommunityOptions.map(option => option.pubkey).filter(Boolean)),
    )
    if (communityPubkeys.length === 0) return []

    return [
      {
        kinds: [TARGETED_PUBLICATION_KIND],
        authors: [$pubkey],
        "#p": communityPubkeys,
        "#k": [String(REACTION)],
      } as Filter,
    ]
  })
  const userCommunityStarTargetEvents = $derived.by(() =>
    userCommunityStarTargetFilters.length
      ? deriveEventsDesc(deriveEventsById({repository, filters: userCommunityStarTargetFilters as any}))
      : undefined,
  )
  const userCommunityStarTargetDeleteFilters = $derived.by(() =>
    makeTargetDeleteFilters(
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
  const userCommunityStarReactionFilters = $derived.by(() =>
    $pubkey && eligibleUserCommunityStarTargetEvents.length
      ? makeTargetedPublicationOriginalFilters(eligibleUserCommunityStarTargetEvents, [$pubkey])
      : [],
  )
  const userCommunityStarReactionEvents = $derived.by(() =>
    userCommunityStarReactionFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: userCommunityStarReactionFilters as any}),
        )
      : undefined,
  )

  const activeUserAllCommunityRepoStarCollections = $derived.by(
    (): RepoCollectionCommunityStar[] => {
      if (
        !$pubkey ||
        !$userCommunityStarReactionEvents ||
        eligibleUserCommunityStarTargetEvents.length === 0
      ) {
        return []
      }

      const communityOptionsByPubkey = new Map(
        repoStarCommunityOptions.map(option => [option.pubkey, option]),
      )
      const targetsByTargetingId = new Map<
        string,
        Array<{targetEvent: TrustedEvent; community: RepoCommunityOption}>
      >()
      const targetsByOriginalEventId = new Map<
        string,
        Array<{targetEvent: TrustedEvent; community: RepoCommunityOption}>
      >()

      const addTarget = (
        map: Map<string, Array<{targetEvent: TrustedEvent; community: RepoCommunityOption}>>,
        key: string,
        target: {targetEvent: TrustedEvent; community: RepoCommunityOption},
      ) => {
        const current = map.get(key) || []
        current.push(target)
        map.set(key, current)
      }

      for (const event of eligibleUserCommunityStarTargetEvents) {
        const targeting = parseTargetedPublication(event)
        if (!targeting) continue

        const communities = targeting.communities
          .map(community => communityOptionsByPubkey.get(community.pubkey))
          .filter((community): community is RepoCommunityOption => Boolean(community))
        if (communities.length === 0) continue

        for (const community of communities) {
          const target = {targetEvent: event, community}
          addTarget(targetsByTargetingId, targeting.id, target)
          if (targeting.ref?.type === "e") {
            addTarget(targetsByOriginalEventId, targeting.ref.value, target)
          }
        }
      }

      if (targetsByTargetingId.size === 0 && targetsByOriginalEventId.size === 0) return []

      return ($userCommunityStarReactionEvents as TrustedEvent[]).flatMap(event => {
        if (event.pubkey !== $pubkey) return []

        const star = parseRepoStarReaction(event)
        if (!star) return []

        const targets =
          targetsByTargetingId.get(getPublicationTargetingId(event)) ||
          targetsByOriginalEventId.get(event.id) ||
          []

        return targets.map(target => ({...target, star}))
      })
    },
  )

  const existingPersonalStar = $derived.by(() =>
    $activeRepoStars.find(star =>
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
    community.label || getCommunityOptionLabel(community.pubkey)

  const publishPersonalRepoStar = ({createdAt}: {createdAt: number}) => {
    const relays = getRepoStarRelays([eventRelayHint, ...collectionRelays])
    const starEvent = {
      ...makeRepoStarReaction({
        event: repoEvent,
        address: repoAddress,
        relayHints: eventRelayHint ? [eventRelayHint] : [],
      }),
      created_at: createdAt,
    }
    const thunk = publishThunk({event: starEvent, relays})

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
    const relays = getRepoStarRelays([
      eventRelayHint,
      community.relay || "",
      ...(community.relays || []),
      ...collectionRelays,
    ])
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
    const starThunk = publishThunk({event: starEvent, relays})
    if (starThunk?.event) repository.publish(starThunk.event as TrustedEvent)

    const targetingEvent = makeEvent(TARGETED_PUBLICATION_KIND, {
      ...makeTargetedPublicationForCommunity({
        targetingId,
        originalKind: REACTION,
        communityPubkey: community.pubkey,
        communityRelay: community.relay || community.relays?.[0],
      }),
      created_at: createdAt + 1,
    })
    const targetingThunk = publishThunk({event: targetingEvent, relays})
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
    const relays = getRepoStarRelays([
      eventRelayHint,
      collection.star.relayHint,
      ...(collection.star.relayHints || []),
      community?.relay || "",
      ...(community?.relays || []),
      ...collectionRelays,
    ])
    const targetDelete = publishDelete({event: collection.targetEvent, relays})
    if (targetDelete?.event) repository.publish(targetDelete.event as TrustedEvent)

    const starDelete = publishDelete({event: collection.star.reaction, relays})
    if (starDelete?.event) repository.publish(starDelete.event as TrustedEvent)

    return [targetDelete, starDelete] as Array<PublishThunkResult | undefined>
  }

  const loadFilters = (label: string, relays: string[], filters: Filter[]) => {
    if (relays.length === 0 || filters.length === 0) return

    const key = getLoadKey(relays, filters, label)
    if (loadedFilterKeys.has(key)) return

    loadedFilterKeys.add(key)
    load({relays, filters: filters as any}).catch(error => {
      console.warn(`[repo-collect] Failed to load ${label}`, error)
    })
  }

  const openCollectModal = () => {
    if (!$pubkey) {
      pushModal(LogIn)
      return
    }

    if (!repoAddress || pending) return

    const personalStar = existingPersonalStar
    const communityStars = existingCommunityStars
    const existingCommunityByPubkey = new Map(
      communityStars.map(collection => [collection.community.pubkey, collection]),
    )
    const communityOptions = [...repoStarCommunityOptions]

    for (const collection of communityStars) {
      if (!communityOptions.some(option => option.pubkey === collection.community.pubkey)) {
        communityOptions.push(collection.community)
      }
    }

    pushModal(RepoCollectModal, {
      title: "Edit collections",
      submitLabel: "Update",
      submittingLabel: "editing collections...",
      communityOptions,
      allowEmpty: true,
      requireChanges: true,
      defaultPersonal: Boolean(personalStar),
      defaultCommunityPubkeys: Array.from(existingCommunityByPubkey.keys()),
      onCancel: clearModals,
      onCollect: async ({
        personal,
        communityPubkeys,
      }: {
        personal: boolean
        communityPubkeys: string[]
      }) => {
        if (pending) return

        pending = true
        try {
          const baseCreatedAt = Math.floor(Date.now() / 1000)
          const selectedCommunityPubkeys = new Set(communityPubkeys)
          const actions: Array<{
            thunks: Array<PublishThunkResult | undefined>
            mode: "all" | "any"
            failureMessage: string
          }> = []

          if (personalStar && !personal) {
            const relays = getRepoStarRelays([
              eventRelayHint,
              ...(personalStar.relayHints || []),
              ...collectionRelays,
            ])
            const thunk = publishDelete({event: personalStar.reaction, relays})
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
            if (selectedCommunityPubkeys.has(collection.community.pubkey)) continue

            actions.push({
              thunks: deleteCommunityRepoStar({collection, community: collection.community}),
              mode: "all",
              failureMessage: `failed to remove from ${getRepoCollectionCommunityLabel(collection.community)}`,
            })
          }

          for (const [index, communityPubkey] of communityPubkeys.entries()) {
            if (existingCommunityByPubkey.has(communityPubkey)) continue

            const community = repoStarCommunityOptions.find(option => option.pubkey === communityPubkey)
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
          pushToast({message: "Failed to edit repository collections", theme: "error"})
        } finally {
          pending = false
        }
      },
    })
  }

  $effect(() => {
    if (!$pubkey) return

    hydratePreferredCommunities({relayHints: collectionRelays}).catch(error => {
      console.warn("[repo-collect] Failed to hydrate preferred communities", error)
    })
  })

  $effect(() => {
    if (!$pubkey || !repoAddress) return

    hydrateRepoStars({relayHints: collectionRelays, repoAddress}).catch(error => {
      console.warn("[repo-collect] Failed to hydrate repo stars", error)
    })
  })

  $effect(() => loadFilters("community star targets", repoStarCommunityRelays, userCommunityStarTargetFilters))
  $effect(() =>
    loadFilters("community star target deletes", repoStarCommunityRelays, userCommunityStarTargetDeleteFilters),
  )
  $effect(() => loadFilters("community star reactions", repoStarCommunityRelays, userCommunityStarReactionFilters))
</script>

<button
  type="button"
  class={`${className} ${collected ? "border-amber-400/60 bg-amber-400/10 text-amber-600 dark:text-amber-400" : ""}`}
  aria-label={collected ? "Edit repository collections" : "Collect repository"}
  title={collected ? "Edit repository collections" : "Collect repository"}
  disabled={disabled || pending}
  onclick={openCollectModal}>
  <Star class={`${iconClass} ${collected ? "fill-current" : ""}`} />
</button>
