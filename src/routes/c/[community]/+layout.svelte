<style>
  @media (max-width: 1023.98px) {
    :global(.community-with-floating-menu [data-component="PageBar"]) {
      padding-right: calc(var(--sair) + 4rem);
    }
  }
</style>

<script lang="ts">
  import {onDestroy, onMount, tick, type Snippet} from "svelte"
  import {page} from "$app/stores"
  import {ago, MONTH} from "@welshman/lib"
  import {pubkey, repository, tracker} from "@welshman/app"
  import {request} from "@welshman/net"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {DELETE, displayRelayUrl, MESSAGE} from "@welshman/util"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import CommunityMenu from "@app/components/CommunityMenu.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Page from "@lib/components/Page.svelte"
  import SecondaryNav from "@lib/components/SecondaryNav.svelte"
  import {pushToast} from "@app/util/toast"
  import {pushDrawer} from "@app/util/modal"
  import {checked, ensureCommunityNotificationBaseline, setCheckedAt} from "@app/util/notifications"
  import {deriveRelayAuthError} from "@app/core/state"
  import {parseCommunityRouteParam} from "@app/util/routes"
  import {
    activeCommunityAdmissionForms,
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityModeratorRequestReactionEvents,
    activeCommunityModeratorRequests,
    activeCommunityPermissionStatus,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
    activeCommunityReportState,
    ensureCommunityBootstrap,
    getCommunityBootstrapKey,
    hydrateCommunityEventsWithStatus,
    makeCommunitySession,
    setActiveCommunityInput,
  } from "@app/core/community-state"
  import {FORM_RESPONSE_KIND, parseTargetedPublication} from "@app/core/community"
  import {canWriteCommunityTarget} from "@app/core/community-permissions"
  import {
    COMMUNITY_EXCLUSIVE_KINDS,
    COMMUNITY_TARGETABLE_KINDS,
    makeCommunityTargetingFilter,
  } from "@app/core/community-feeds"
  import {
    getCommunityDeleteSeenKey,
    getCommunityDeleteSince,
    hydrateCommunityDeleteEvents,
    normalizeDeleteCheckpoint,
  } from "@app/core/community-deletes"
  import {
    buildCommunityHistoricalDiscoveryFilters,
    buildCommunityFiniteFollowUpFilters,
    buildCommunityLiveFilters,
    getCommunityFiniteFollowUpRelays,
    getCommunityLiveSubscriptionKey,
    normalizeCommunityLiveValues,
    registerCommunityLiveOwnership,
  } from "@app/core/community-live"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const hasInlineCommunityMenu = $derived(
    [
      "/c/[community]",
      "/c/[community]/access",
      "/c/[community]/admin",
      "/c/[community]/badges",
      "/c/[community]/calendar",
      "/c/[community]/calendar/create",
      "/c/[community]/calendar/[event]",
      "/c/[community]/git",
      "/c/[community]/goals",
      "/c/[community]/goals/create",
      "/c/[community]/goals/[goal]",
      "/c/[community]/moderation",
      "/c/[community]/permalinks",
      "/c/[community]/rooms",
      "/c/[community]/rooms/[room]",
      "/c/[community]/threads",
      "/c/[community]/threads/create",
      "/c/[community]/threads/[thread]",
      "/c/[community]/widgets",
    ].includes($page.route.id || ""),
  )
  const pageClass = $derived(
    parsedCommunity
      ? hasInlineCommunityMenu
        ? "community-with-menu"
        : "community-with-menu community-with-floating-menu"
      : "cw-full",
  )

  let authRelayUrl = $state("")
  let relayAuthError = $state("")
  let shownAuthErrorKey = $state("")
  // Per-relay subscriptions so the community live stream expands additively
  // when new relays are discovered instead of tearing down existing streams.
  let communityLiveFiltersKey = ""
  let communityLiveRetryVersion = $state(0)
  let communityLiveRetryTimer: ReturnType<typeof setTimeout> | null = null
  const communityLiveSubscriptionsByRelay = new Map<
    string,
    {controller: AbortController; releaseOwnership: () => void}
  >()
  let communityHistoryLoadKey = ""
  let communityHistoryLoadController: AbortController | null = null
  let communityHistoryRetryVersion = $state(0)
  let communityHistoryRetryTimer: ReturnType<typeof setTimeout> | null = null
  let communityDeleteLoadKey = ""
  let communityDeleteLoadController: AbortController | null = null
  let latestCommunityDeleteSeen = 0
  let communityFollowUpLoadKey = ""
  let communityFollowUpLoadController: AbortController | null = null
  let communityFollowUpRetryVersion = $state(0)
  let communityFollowUpRetryTimer: ReturnType<typeof setTimeout> | null = null
  let communityBackgroundHydrationReady = $state(false)
  const COMMUNITY_HISTORY_LOAD_TIMEOUT_MS = 5_000
  const communityDeleteKinds = Array.from(
    new Set(
      [...COMMUNITY_EXCLUSIVE_KINDS, ...COMMUNITY_TARGETABLE_KINDS].filter(kind => kind !== DELETE),
    ),
  )

  const communityTargetingFilters = $derived(
    $activeCommunityDefinition
      ? [makeCommunityTargetingFilter($activeCommunityDefinition.pubkey)]
      : [],
  )
  const communityTargetingEventsStore = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: communityTargetingFilters})),
  )
  const authorizedCommunityTargetingEvents = $derived(
    $communityTargetingEventsStore.filter(event => {
      const targeting = parseTargetedPublication(event)

      return Boolean(
        targeting &&
        $activeCommunityDefinition &&
        canWriteCommunityTarget({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          userPubkey: event.pubkey,
          target: {sectionName: "", kind: targeting.kind},
          reportState: $activeCommunityReportState,
        }),
      )
    }),
  )
  const effectiveCommunityReportEvents = $derived(
    [...$activeCommunityReportState.eventReports, ...$activeCommunityReportState.personReports].map(
      report => report.event,
    ),
  )
  const admissionFormAddresses = $derived(
    normalizeCommunityLiveValues(
      Object.values($activeCommunityAdmissionForms).map(form => form.address),
    ),
  )
  const admissionResponseFilters = $derived(
    admissionFormAddresses.length
      ? [{kinds: [FORM_RESPONSE_KIND], "#a": admissionFormAddresses}]
      : [],
  )
  const admissionResponseEventsStore = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: admissionResponseFilters})),
  )
  const admissionResponseIds = $derived(
    normalizeCommunityLiveValues($admissionResponseEventsStore.map(event => event.id)),
  )
  const communityDeleteSeenKey = $derived(
    getCommunityDeleteSeenKey($activeCommunityDefinition?.pubkey || ""),
  )
  const lastCommunityDeleteSeen = $derived(
    communityDeleteSeenKey ? normalizeDeleteCheckpoint($checked[communityDeleteSeenKey] || 0) : 0,
  )

  const stopCommunityLiveSubscription = () => {
    if (communityLiveRetryTimer) clearTimeout(communityLiveRetryTimer)
    communityLiveRetryTimer = null
    for (const subscription of communityLiveSubscriptionsByRelay.values()) {
      subscription.controller.abort()
      subscription.releaseOwnership()
    }
    communityLiveSubscriptionsByRelay.clear()
    communityLiveFiltersKey = ""
  }

  const stopCommunityHistoryLoad = () => {
    if (communityHistoryRetryTimer) clearTimeout(communityHistoryRetryTimer)
    communityHistoryRetryTimer = null
    communityHistoryLoadController?.abort()
    communityHistoryLoadController = null
    communityHistoryLoadKey = ""
  }

  const stopCommunityDeleteLoad = () => {
    communityDeleteLoadController?.abort()
    communityDeleteLoadController = null
    communityDeleteLoadKey = ""
  }

  const stopCommunityFollowUpLoad = () => {
    if (communityFollowUpRetryTimer) clearTimeout(communityFollowUpRetryTimer)
    communityFollowUpRetryTimer = null
    communityFollowUpLoadController?.abort()
    communityFollowUpLoadController = null
    communityFollowUpLoadKey = ""
  }

  const openCommunityMenu = () => {
    if (parsedCommunity)
      pushDrawer(CommunityMenu, {community: parsedCommunity.pubkey}, {replaceState: true})
  }

  const waitForPostPaintHydration = async () => {
    await tick()
    if (typeof requestAnimationFrame !== "function") return
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }

  onMount(() => {
    let cancelled = false

    void waitForPostPaintHydration().then(() => {
      if (!cancelled) communityBackgroundHydrationReady = true
    })

    return () => {
      cancelled = true
      communityBackgroundHydrationReady = false
    }
  })

  $effect(() => {
    const routeCommunity = $page.params.community || ""
    const currentPubkey = $pubkey || ""

    const load = async () => {
      if (!parsedCommunity) {
        activeCommunityBootstrapStatus.set({key: "", loading: false, loaded: false})
        return
      }

      const session =
        setActiveCommunityInput(decodeURIComponent(routeCommunity)) ||
        makeCommunitySession(parsedCommunity)
      const communityKey = getCommunityBootstrapKey(session, currentPubkey)

      // Immediately clear any stale error left over from a previous community
      // or a previous failed attempt on this one. `ensureCommunityBootstrap`
      // will re-set the status below; this just guarantees the banner never
      // paints for the wrong community while navigation is in flight.
      activeCommunityBootstrapStatus.set({key: communityKey, loading: true, loaded: false})

      try {
        await ensureCommunityBootstrap(session, {key: communityKey})
      } catch (error) {
        console.warn("[community] Failed to load community metadata", error)
      }
    }

    load()
  })

  $effect.pre(() => {
    ensureCommunityNotificationBaseline({
      viewerPubkey: $pubkey || undefined,
      communityPubkey: parsedCommunity?.pubkey,
    })
  })

  $effect(() => {
    const url = $activeCommunityDefinition?.relays[0] || parsedCommunity?.relays[0] || ""

    authRelayUrl = url
    relayAuthError = ""

    if (!$pubkey || !url) return

    const authError = deriveRelayAuthError(url)
    const unsubscribe = authError.subscribe(error => {
      if (authRelayUrl !== url) return

      relayAuthError = error || ""

      if (!error) return

      const key = `${url}:${error}`

      if (shownAuthErrorKey === key) return
      shownAuthErrorKey = key
      pushToast({theme: "error", message: `Access issue on ${displayRelayUrl(url)}: ${error}`})
    })

    return unsubscribe
  })

  $effect(() => {
    void communityHistoryRetryVersion

    if (!communityBackgroundHydrationReady) {
      stopCommunityHistoryLoad()
      return
    }

    const definition = $activeCommunityDefinition
    const relays = normalizeCommunityLiveValues($activeCommunityRelays)
    const authorityReady = Boolean(
      definition &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading &&
      $activeCommunityPermissionStatus.communityPubkey === definition.pubkey &&
      ($activeCommunityPermissionStatus.loaded || $activeCommunityPermissionStatus.hasCachedEvents),
    )

    if (!definition || !authorityReady || relays.length === 0) {
      stopCommunityHistoryLoad()
      return
    }

    const key = `${definition.pubkey}::${relays.join("|")}`
    if (communityHistoryLoadKey === key) return

    communityHistoryLoadController?.abort()
    communityHistoryLoadKey = key
    const controller = new AbortController()
    communityHistoryLoadController = controller

    void hydrateCommunityEventsWithStatus({
      key: `community-discovery:${key}`,
      relays,
      filters: [
        {kinds: [MESSAGE], "#h": [definition.pubkey], since: ago(MONTH)},
        ...buildCommunityHistoricalDiscoveryFilters(definition.pubkey),
      ],
      authenticate: true,
      timeout: COMMUNITY_HISTORY_LOAD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.community,
      signal: controller.signal,
    }).then(result => {
      if (communityHistoryLoadController !== controller) return
      communityHistoryLoadController = null

      if (!result.complete && !controller.signal.aborted) {
        console.warn("[community-history] Community historical discovery is incomplete", result)
        communityHistoryLoadKey = ""
        if (communityHistoryRetryTimer) clearTimeout(communityHistoryRetryTimer)
        communityHistoryRetryTimer = setTimeout(() => {
          communityHistoryRetryTimer = null
          communityHistoryRetryVersion += 1
        }, 5000)
      }
    })
  })

  $effect(() => {
    void communityFollowUpRetryVersion

    if (!communityBackgroundHydrationReady) {
      stopCommunityFollowUpLoad()
      return
    }

    const definition = $activeCommunityDefinition
    const relays = normalizeCommunityLiveValues($activeCommunityRelays)
    const followUpRelays = getCommunityFiniteFollowUpRelays(
      relays,
      authorizedCommunityTargetingEvents,
    )

    if (!definition || relays.length === 0) {
      stopCommunityFollowUpLoad()
      return
    }

    const filters = buildCommunityFiniteFollowUpFilters({
      definition,
      targetingEvents: authorizedCommunityTargetingEvents,
      admissionResponseIds,
      reportEvents: effectiveCommunityReportEvents,
      moderatorRequests: $activeCommunityModeratorRequests,
      moderatorRequestReactionEvents: $activeCommunityModeratorRequestReactionEvents,
    })

    if (filters.length === 0) {
      stopCommunityFollowUpLoad()
      return
    }

    const key = getCommunityLiveSubscriptionKey({
      communityPubkey: definition.pubkey,
      relays: followUpRelays,
      filters,
    })
    if (communityFollowUpLoadKey === key) return

    communityFollowUpLoadController?.abort()
    communityFollowUpLoadKey = key
    const controller = new AbortController()
    communityFollowUpLoadController = controller

    void hydrateCommunityEventsWithStatus({
      key: `community-follow-up:${key}`,
      relays: followUpRelays,
      filters,
      authenticate: true,
      timeout: COMMUNITY_HISTORY_LOAD_TIMEOUT_MS,
      signal: controller.signal,
      priority: RELAY_REQUEST_PRIORITY.community,
    }).then(result => {
      if (communityFollowUpLoadController !== controller) return
      communityFollowUpLoadController = null
      if (result.complete) return

      communityFollowUpLoadKey = ""
      if (communityFollowUpRetryTimer) clearTimeout(communityFollowUpRetryTimer)
      communityFollowUpRetryTimer = setTimeout(() => {
        communityFollowUpRetryTimer = null
        communityFollowUpRetryVersion += 1
      }, 5000)
    })
  })

  $effect(() => {
    if (!communityBackgroundHydrationReady) {
      stopCommunityDeleteLoad()
      return
    }

    const definition = $activeCommunityDefinition
    const relays = normalizeCommunityLiveValues($activeCommunityRelays)

    if (!definition || relays.length === 0) {
      stopCommunityDeleteLoad()
      return
    }

    const since = getCommunityDeleteSince(lastCommunityDeleteSeen)
    const key = `${definition.pubkey}::${relays.join("|")}::${since}`
    if (communityDeleteLoadKey === key) return

    communityDeleteLoadController?.abort()
    communityDeleteLoadKey = key
    const controller = new AbortController()
    communityDeleteLoadController = controller

    void hydrateCommunityDeleteEvents({
      relays,
      kinds: communityDeleteKinds,
      since,
      signal: controller.signal,
    }).then(latest => {
      if (latest > latestCommunityDeleteSeen) latestCommunityDeleteSeen = latest
    })

    return () => controller.abort()
  })

  $effect(() => {
    void communityLiveRetryVersion

    if (!communityBackgroundHydrationReady) {
      stopCommunityLiveSubscription()
      return
    }

    const definition = $activeCommunityDefinition
    const relays = normalizeCommunityLiveValues($activeCommunityRelays)

    if (!definition || relays.length === 0) {
      stopCommunityLiveSubscription()
      return
    }

    const filters = buildCommunityLiveFilters({
      definition,
      admissionFormAddresses,
    })

    if (filters.length === 0) {
      stopCommunityLiveSubscription()
      return
    }

    // Key on the filter/community shape without relays. If it changes we
    // tear down and rebuild; if only the relay set changes we diff below.
    const filtersKey = getCommunityLiveSubscriptionKey({
      communityPubkey: definition.pubkey,
      relays: [],
      filters,
    })
    if (communityLiveFiltersKey !== filtersKey) {
      stopCommunityLiveSubscription()
      communityLiveFiltersKey = filtersKey
    }

    const targetRelays = new Set(relays)

    for (const [url, subscription] of communityLiveSubscriptionsByRelay) {
      if (!targetRelays.has(url)) {
        subscription.controller.abort()
        subscription.releaseOwnership()
        communityLiveSubscriptionsByRelay.delete(url)
      }
    }

    for (const url of targetRelays) {
      if (communityLiveSubscriptionsByRelay.has(url)) continue
      const controller = new AbortController()
      const releaseOwnership = registerCommunityLiveOwnership(definition.pubkey, url)
      let failed = false
      const subscription = {controller, releaseOwnership}
      communityLiveSubscriptionsByRelay.set(url, subscription)
      request({
        relays: [url],
        filters,
        lifetime: "live",
        signal: controller.signal,
        priority: RELAY_REQUEST_PRIORITY.live,
        owner: "community-core",
        onClosed: () => {
          failed = true
          controller.abort()
        },
        onDisconnect: () => {
          failed = true
        },
        onEvent: (event, relay) => {
          tracker.addRelay(event.id, relay)
          repository.publish(event)
        },
      })
        .catch(error => {
          if (!controller.signal.aborted) {
            console.warn("[community-live] Failed to subscribe to community activity", error)
          }
        })
        .finally(() => {
          if (controller.signal.aborted && !failed) return
          if (communityLiveSubscriptionsByRelay.get(url) !== subscription) return
          communityLiveSubscriptionsByRelay.delete(url)
          releaseOwnership()
          if (communityLiveRetryTimer) clearTimeout(communityLiveRetryTimer)
          communityLiveRetryTimer = setTimeout(() => {
            communityLiveRetryTimer = null
            communityLiveRetryVersion += 1
          }, 5500)
        })
    }
  })

  onDestroy(() => {
    stopCommunityHistoryLoad()
    stopCommunityDeleteLoad()
    stopCommunityFollowUpLoad()
    stopCommunityLiveSubscription()
    if (communityDeleteSeenKey) {
      setCheckedAt(
        communityDeleteSeenKey,
        Math.max(lastCommunityDeleteSeen, latestCommunityDeleteSeen),
      )
    }
  })
</script>

{#if parsedCommunity}
  <SecondaryNav>
    <CommunityMenu community={parsedCommunity.pubkey} />
  </SecondaryNav>
  {#if !hasInlineCommunityMenu}
    <button
      type="button"
      class="btn btn-neutral btn-sm fixed right-[calc(var(--sair)+0.75rem)] top-[calc(var(--sait)+0.75rem)] z-nav lg:hidden"
      aria-label="Open community menu"
      onclick={openCommunityMenu}>
      <Icon icon={MenuDots} />
    </button>
  {/if}
{/if}

<Page class={pageClass}>
  {#if !parsedCommunity}
    <div class="content p-4">
      <h1 class="text-2xl font-bold">Invalid community</h1>
      <p>Use a valid community npub, hex pubkey, or encoded ncommunity value.</p>
    </div>
  {:else}
    {#if relayAuthError && authRelayUrl}
      <div class="card2 m-2 border border-error/30 bg-error/10 p-4 text-sm">
        <strong>Community relay access issue</strong>
        <p class="mt-1 opacity-80">
          {displayRelayUrl(authRelayUrl)} reported: {relayAuthError}
        </p>
      </div>
    {/if}
    {@render children?.()}
  {/if}
</Page>
