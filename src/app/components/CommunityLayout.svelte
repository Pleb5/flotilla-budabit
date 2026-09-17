<style>
  @media (max-width: 1023.98px) {
    :global(.community-with-floating-menu [data-component="PageBar"]) {
      padding-right: calc(var(--sair) + 4rem);
    }
  }
  /* Child pages use fixed surfaces; reserve the measured connection panel height. */
  .community-connection-content :global([data-component="PageBar"]) {
    top: calc(var(--sait) + var(--community-connection-height));
  }
  .community-connection-content :global([data-component="PageContent"]) {
    top: calc(var(--sait) + 3rem + var(--community-connection-height));
  }
</style>

<script lang="ts">
  import {onDestroy, onMount, tick, type Snippet} from "svelte"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
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
  import {makeCanonicalExactCommunityUrl, parseExactCommunityRouteParam} from "@app/util/routes"
  import {
    activeCommunityAdmissionForms,
    activeCommunityDescriptor,
    activeCommunityBootstrapStatus,
    activeCommunityModeratorRequestReactionEvents,
    activeCommunityModeratorRequests,
    activeCommunityPermissionStatus,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
    activeExactCommunityRelays,
    activeExactCommunitySession,
    ensureCommunityBootstrap,
    getCommunityBootstrapKey,
    hydrateCommunityEventsWithStatus,
    makeExactCommunitySession,
    setActiveExactCommunityPointer,
    clearActiveExactCommunity,
  } from "@app/core/community-state"
  import {
    FORM_RESPONSE_KIND,
    makeTargetedPublicationLifecycleFilters,
    normalizePubkey,
  } from "@app/core/community"
  import {filterAuthorizedCommunityTargetingEvents} from "@app/core/community-permissions"
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
    buildCommunityFiniteFollowUpRelayPlans,
    buildCommunityLiveFilters,
    getCommunityLiveSubscriptionKey,
    normalizeCommunityLiveValues,
    registerCommunityLiveOwnership,
  } from "@app/core/community-live"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {
    communityReadRecovery,
    communityReadRecoveryVersion,
  } from "@app/core/community-read-recovery"
  import {activeCommunityRoomLoad} from "@app/core/community-foreground"
  import {
    createCommunityMaintenanceAdmission,
    type CommunityMaintenanceAdmissionState,
  } from "@app/core/community-startup-admission"

  type Props = {
    children?: Snippet
    connection?: Snippet
  }

  const {children, connection}: Props = $props()
  let connectionHeight = $state(0)

  const routeCommunity = $derived($page.params.community || "")
  const exactCommunity = $derived(parseExactCommunityRouteParam(routeCommunity))
  const readRecovery = $derived(communityReadRecovery(exactCommunity?.address || "", $pubkey || ""))
  const readableRelays = $derived.by(() => {
    void $communityReadRecoveryVersion
    return readRecovery.available(normalizeCommunityLiveValues($activeExactCommunityRelays))
  })
  const exactCommunityBootstrapKey = $derived(
    exactCommunity
      ? getCommunityBootstrapKey(makeExactCommunitySession(exactCommunity), $pubkey || "")
      : "",
  )
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
    exactCommunity
      ? hasInlineCommunityMenu
        ? "community-with-menu"
        : "community-with-menu community-with-floating-menu"
      : "cw-full",
  )
  const activeRoomLoadPending = $derived(
    Boolean(
      exactCommunity &&
      ($page.route.id === "/c/[community]"
        ? $activeCommunityRoomLoad.communityAddress !== exactCommunity.address ||
          $activeCommunityRoomLoad.roomId !== "" ||
          $activeCommunityRoomLoad.pending
        : $activeCommunityRoomLoad.pending &&
          $activeCommunityRoomLoad.communityAddress === exactCommunity.address),
    ),
  )

  let authRelayUrl = $state("")
  let relayAuthError = $state("")
  let shownAuthErrorKey = $state("")
  let communityBootstrapInputKey = ""
  let communityDefinitionPermissionRefreshKey = ""
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
  let communityDeleteRetryVersion = $state(0)
  let communityDeleteRetryTimer: ReturnType<typeof setTimeout> | null = null
  const latestCommunityDeleteSeenByKey: Record<string, number> = {}
  let communityDeleteCheckpointKey = ""
  let communityFollowUpLoadKey = ""
  let communityFollowUpLoadController: AbortController | null = null
  let communityFollowUpRetryVersion = $state(0)
  let communityFollowUpRetryTimer: ReturnType<typeof setTimeout> | null = null
  let communityBackgroundHydrationReady = $state(false)
  let communityMaintenanceAdmission = $state<CommunityMaintenanceAdmissionState>({
    history: false,
    "follow-up": false,
    deletes: false,
    menu: false,
  })
  const maintenanceAdmission = createCommunityMaintenanceAdmission({
    onChange: state => (communityMaintenanceAdmission = state),
  })
  const COMMUNITY_HISTORY_LOAD_TIMEOUT_MS = 5_000
  const COMMUNITY_DELETE_LOAD_TIMEOUT_MS = 5_000
  const communityDeleteKinds = Array.from(
    new Set(
      [...COMMUNITY_EXCLUSIVE_KINDS, ...COMMUNITY_TARGETABLE_KINDS].filter(kind => kind !== DELETE),
    ),
  )

  const communityTargetingFilters = $derived(
    $activeExactCommunityPointer
      ? [makeCommunityTargetingFilter($activeExactCommunityPointer.communityId)]
      : [],
  )
  const communityTargetingCandidateEventsStore = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: communityTargetingFilters})),
  )
  const communityTargetingLifecycleFilters = $derived(
    makeTargetedPublicationLifecycleFilters($communityTargetingCandidateEventsStore),
  )
  const communityTargetingEventsStore = $derived(
    deriveEventsAsc(
      deriveEventsById({
        repository,
        filters: [...communityTargetingFilters, ...communityTargetingLifecycleFilters],
      }),
    ),
  )
  const authorizedCommunityTargetingEvents = $derived(
    $activeExactCommunityDefinition &&
      $activeExactCommunityPointer &&
      $activeExactCommunityDefinition.pointer.address === exactCommunity?.address &&
      $activeExactCommunityPointer.address === exactCommunity?.address &&
      $activeCommunityDescriptor?.community.address === exactCommunity?.address &&
      $activeCommunityDescriptor.authorityReadiness.state === "ready"
      ? filterAuthorizedCommunityTargetingEvents({
          community: $activeExactCommunityPointer!,
          definition: $activeExactCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $communityTargetingEventsStore,
          reportState: $activeCommunityReportState,
        })
      : [],
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
  const communityDeleteSeenKey = $derived(getCommunityDeleteSeenKey(exactCommunity?.address || ""))
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
    if (communityDeleteRetryTimer) clearTimeout(communityDeleteRetryTimer)
    communityDeleteRetryTimer = null
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
    if (exactCommunity) pushDrawer(CommunityMenu, {community: exactCommunity}, {replaceState: true})
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

  $effect.pre(() => {
    const pointer = exactCommunity
    if (!pointer) {
      clearActiveExactCommunity()
      return
    }
    setActiveExactCommunityPointer(pointer)

    const canonical = makeCanonicalExactCommunityUrl($page.url, pointer)
    const current = `${$page.url.pathname}${$page.url.search}${$page.url.hash}`
    if (canonical !== current) void goto(canonical, {replaceState: true})
  })

  $effect(() => {
    const currentPubkey = $pubkey || ""
    const activeSession = $activeExactCommunitySession
    const definitionEventId =
      activeSession &&
      exactCommunity &&
      activeSession.definition.ownerPubkey === exactCommunity.ownerPubkey &&
      activeSession.definition.communityId === exactCommunity.communityId
        ? activeSession.definitionEventId || ""
        : ""
    const inputKey = JSON.stringify([routeCommunity, currentPubkey, definitionEventId])

    if (communityBootstrapInputKey === inputKey) return
    communityBootstrapInputKey = inputKey

    const load = async () => {
      if (!exactCommunity) {
        activeCommunityBootstrapStatus.set({key: "", loading: false, loaded: false})
        return
      }

      const session = makeExactCommunitySession(exactCommunity, definitionEventId || undefined)
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

  // A definition can also arrive through the live subscription after bootstrap.
  // Refresh its permission filters before route catalogs use the new definition.
  $effect(() => {
    const definition = $activeExactCommunityDefinition
    const session = $activeExactCommunitySession
    const viewer = normalizePubkey($pubkey || "")
    const bootstrapKey = session ? getCommunityBootstrapKey(session, viewer) : ""
    const permissionPrefix = definition ? `${viewer}:${definition.event.id}:` : ""
    const key = definition && session ? `${bootstrapKey}:${definition.event.id}` : ""

    if (
      !definition ||
      !session ||
      definition.pointer.address !== exactCommunity?.address ||
      definition.pointer.address !== $activeExactCommunityPointer?.address ||
      definition.ownerPubkey !== session.definition.ownerPubkey ||
      definition.communityId !== session.definition.communityId ||
      $activeCommunityBootstrapStatus.key !== bootstrapKey ||
      !$activeCommunityBootstrapStatus.loaded ||
      $activeCommunityBootstrapStatus.loading
    ) {
      if (!key) communityDefinitionPermissionRefreshKey = ""
      return
    }

    if ($activeCommunityPermissionStatus.key.startsWith(permissionPrefix)) {
      communityDefinitionPermissionRefreshKey = ""
      return
    }

    if (communityDefinitionPermissionRefreshKey === key) return
    communityDefinitionPermissionRefreshKey = key
    void ensureCommunityBootstrap(session, {key: bootstrapKey, updateStatus: false}).catch(
      error => {
        if (communityDefinitionPermissionRefreshKey === key) {
          communityDefinitionPermissionRefreshKey = ""
        }
        console.warn("[community] Failed to refresh permissions for updated definition", error)
      },
    )
  })

  $effect.pre(() => {
    ensureCommunityNotificationBaseline({
      viewerPubkey: $pubkey || undefined,
      community: $activeExactCommunityPointer,
    })
  })

  $effect(() => {
    const url = $activeExactCommunityDefinition?.relays[0] || $activeExactCommunityRelays[0] || ""

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
    const definition = $activeExactCommunityDefinition
    const relays = normalizeCommunityLiveValues($activeExactCommunityRelays)
    const authorityReady = Boolean(
      definition &&
      definition.pointer.address === exactCommunity?.address &&
      $activeCommunityBootstrapStatus.key === exactCommunityBootstrapKey &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading &&
      $activeCommunityDescriptor?.community.address === definition.pointer.address &&
      $activeCommunityDescriptor.authorityReadiness.state === "ready",
    )

    if (
      !communityBackgroundHydrationReady ||
      activeRoomLoadPending ||
      !definition ||
      !authorityReady ||
      relays.length === 0
    ) {
      maintenanceAdmission.reset()
      return
    }

    maintenanceAdmission.start(
      JSON.stringify([definition.pointer.address, definition.event.id, $pubkey, relays]),
    )
  })

  $effect(() => {
    void communityHistoryRetryVersion

    if (!communityMaintenanceAdmission.history) {
      stopCommunityHistoryLoad()
      return
    }

    const exactDefinition = $activeExactCommunityDefinition
    const relays = readableRelays
    const recovery = readRecovery
    const authorityReady = Boolean(
      exactDefinition &&
      exactDefinition.pointer.address === exactCommunity?.address &&
      $activeCommunityBootstrapStatus.key === exactCommunityBootstrapKey &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading &&
      $activeCommunityDescriptor?.community.address === exactDefinition.pointer.address &&
      $activeCommunityDescriptor.authorityReadiness.state === "ready",
    )

    if (!exactDefinition || !authorityReady || relays.length === 0) {
      stopCommunityHistoryLoad()
      if (!relays.length) maintenanceAdmission.settle(maintenanceAdmission.getKey(), "history")
      return
    }

    const key = `${exactDefinition.pointer.address}::${$pubkey || ""}::${relays.join("|")}`
    if (communityHistoryLoadKey === key) return

    communityHistoryLoadController?.abort()
    communityHistoryLoadKey = key
    const controller = new AbortController()
    communityHistoryLoadController = controller
    const admissionKey = maintenanceAdmission.getKey()

    void hydrateCommunityEventsWithStatus({
      key: `community-discovery:${key}`,
      relays,
      filters: [
        {kinds: [MESSAGE], "#h": [exactDefinition.communityId], since: ago(MONTH)},
        ...buildCommunityHistoricalDiscoveryFilters(exactDefinition.pointer),
      ],
      authenticate: true,
      timeout: COMMUNITY_HISTORY_LOAD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.community,
      signal: controller.signal,
    }).then(
      result => {
        if (communityHistoryLoadController !== controller) return
        communityHistoryLoadController = null
        maintenanceAdmission.settle(admissionKey, "history")
        if (controller.signal.aborted) return
        recovery.result(result)

        if (result.complete) return

        console.warn("[community-history] Community historical discovery is incomplete", result)
        communityHistoryLoadKey = ""
        const retryRelays = recovery.available(relays)
        if (!retryRelays.length) return
        if (communityHistoryRetryTimer) clearTimeout(communityHistoryRetryTimer)
        communityHistoryRetryTimer = setTimeout(() => {
          communityHistoryRetryTimer = null
          communityHistoryRetryVersion += 1
        }, recovery.delay(retryRelays))
      },
      error => {
        if (controller.signal.aborted || communityHistoryLoadController !== controller) return

        communityHistoryLoadController = null
        communityHistoryLoadKey = ""
        maintenanceAdmission.settle(admissionKey, "history")
        console.warn("[community-history] Failed to load community history", error)
        relays.forEach(relay => recovery.record(relay, "disconnected"))
        const retryRelays = recovery.available(relays)
        if (!retryRelays.length) return
        if (communityHistoryRetryTimer) clearTimeout(communityHistoryRetryTimer)
        communityHistoryRetryTimer = setTimeout(() => {
          communityHistoryRetryTimer = null
          communityHistoryRetryVersion += 1
        }, recovery.delay(retryRelays))
      },
    )
  })

  $effect(() => {
    void communityFollowUpRetryVersion

    if (!communityMaintenanceAdmission["follow-up"]) {
      stopCommunityFollowUpLoad()
      return
    }

    const authorityDefinition = $activeExactCommunityDefinition
    const relays = readableRelays
    const recovery = readRecovery

    if (
      !authorityDefinition ||
      authorityDefinition.pointer.address !== exactCommunity?.address ||
      relays.length === 0
    ) {
      stopCommunityFollowUpLoad()
      if (!relays.length) maintenanceAdmission.settle(maintenanceAdmission.getKey(), "follow-up")
      return
    }

    const plans = buildCommunityFiniteFollowUpRelayPlans({
      authorityDefinition,
      relays,
      targetingEvents: authorizedCommunityTargetingEvents,
      targetingCandidateEvents: $communityTargetingCandidateEventsStore,
      admissionResponseIds,
      reportEvents: effectiveCommunityReportEvents,
      moderatorRequests: $activeCommunityModeratorRequests,
      moderatorRequestReactionEvents: $activeCommunityModeratorRequestReactionEvents,
    }).filter(plan => !recovery.blocked(plan.relay))

    if (plans.length === 0) {
      stopCommunityFollowUpLoad()
      maintenanceAdmission.settle(maintenanceAdmission.getKey(), "follow-up")
      return
    }

    const key = JSON.stringify([
      $pubkey,
      plans.map(plan =>
        getCommunityLiveSubscriptionKey({
          communityPubkey: authorityDefinition.pointer.address,
          relays: [plan.relay],
          filters: plan.filters,
        }),
      ),
    ])
    if (communityFollowUpLoadKey === key) return

    communityFollowUpLoadController?.abort()
    communityFollowUpLoadKey = key
    const controller = new AbortController()
    communityFollowUpLoadController = controller
    const admissionKey = maintenanceAdmission.getKey()

    void Promise.all(
      plans.map(plan =>
        hydrateCommunityEventsWithStatus({
          key: `community-follow-up:${authorityDefinition.pointer.address}:${plan.relay}:${key}`,
          relays: [plan.relay],
          filters: plan.filters,
          authenticate: true,
          timeout: COMMUNITY_HISTORY_LOAD_TIMEOUT_MS,
          signal: controller.signal,
          priority: RELAY_REQUEST_PRIORITY.community,
        }),
      ),
    ).then(
      results => {
        if (communityFollowUpLoadController !== controller) return
        communityFollowUpLoadController = null
        maintenanceAdmission.settle(admissionKey, "follow-up")
        if (controller.signal.aborted) return
        results.forEach(recovery.result)
        if (results.every(result => result.complete)) return

        communityFollowUpLoadKey = ""
        const retryRelays = recovery.available(relays)
        if (!retryRelays.length) return
        if (communityFollowUpRetryTimer) clearTimeout(communityFollowUpRetryTimer)
        communityFollowUpRetryTimer = setTimeout(() => {
          communityFollowUpRetryTimer = null
          communityFollowUpRetryVersion += 1
        }, recovery.delay(retryRelays))
      },
      error => {
        if (controller.signal.aborted || communityFollowUpLoadController !== controller) return

        communityFollowUpLoadController = null
        communityFollowUpLoadKey = ""
        maintenanceAdmission.settle(admissionKey, "follow-up")
        console.warn("[community-follow-up] Failed to load community follow-up events", error)
        relays.forEach(relay => recovery.record(relay, "disconnected"))
        const retryRelays = recovery.available(relays)
        if (!retryRelays.length) return
        if (communityFollowUpRetryTimer) clearTimeout(communityFollowUpRetryTimer)
        communityFollowUpRetryTimer = setTimeout(() => {
          communityFollowUpRetryTimer = null
          communityFollowUpRetryVersion += 1
        }, recovery.delay(retryRelays))
      },
    )
  })

  $effect(() => {
    void communityDeleteRetryVersion

    if (!communityMaintenanceAdmission.deletes) {
      stopCommunityDeleteLoad()
      return
    }

    const definition = $activeExactCommunityDefinition
    const relays = readableRelays
    const recovery = readRecovery

    if (
      !definition ||
      definition.pointer.address !== exactCommunity?.address ||
      relays.length === 0
    ) {
      stopCommunityDeleteLoad()
      if (!relays.length) maintenanceAdmission.settle(maintenanceAdmission.getKey(), "deletes")
      return
    }

    const since = getCommunityDeleteSince(lastCommunityDeleteSeen)
    if (!exactCommunity) {
      stopCommunityDeleteLoad()
      return
    }
    const deleteSeenKey = communityDeleteSeenKey
    if (communityDeleteCheckpointKey && communityDeleteCheckpointKey !== deleteSeenKey) {
      setCheckedAt(
        communityDeleteCheckpointKey,
        Math.max(
          normalizeDeleteCheckpoint($checked[communityDeleteCheckpointKey] || 0),
          latestCommunityDeleteSeenByKey[communityDeleteCheckpointKey] || 0,
        ),
      )
    }
    communityDeleteCheckpointKey = deleteSeenKey
    const key = `${exactCommunity.address}::${$pubkey || ""}::${relays.join("|")}::${since}`
    if (communityDeleteLoadKey === key) return

    communityDeleteLoadController?.abort()
    communityDeleteLoadKey = key
    const controller = new AbortController()
    communityDeleteLoadController = controller
    const admissionKey = maintenanceAdmission.getKey()

    const scheduleRetry = () => {
      const retryRelays = recovery.available(relays)
      if (!retryRelays.length) return
      if (communityDeleteRetryTimer) clearTimeout(communityDeleteRetryTimer)
      communityDeleteRetryTimer = setTimeout(() => {
        communityDeleteRetryTimer = null
        communityDeleteLoadKey = ""
        communityDeleteRetryVersion += 1
      }, recovery.delay(retryRelays))
    }
    const timeout = setTimeout(() => {
      if (communityDeleteLoadController !== controller) return

      controller.abort()
      communityDeleteLoadController = null
      maintenanceAdmission.settle(admissionKey, "deletes")
      relays.forEach(relay => recovery.record(relay, "timeout"))
      scheduleRetry()
    }, COMMUNITY_DELETE_LOAD_TIMEOUT_MS)

    void hydrateCommunityDeleteEvents({
      relays,
      community: exactCommunity,
      kinds: communityDeleteKinds,
      since,
      signal: controller.signal,
      onClosed: (reason, relay) => recovery.closed(relay, reason),
    }).then(
      latest => {
        if (communityDeleteLoadController !== controller) return
        clearTimeout(timeout)
        communityDeleteLoadController = null
        maintenanceAdmission.settle(admissionKey, "deletes")
        if (latest > (latestCommunityDeleteSeenByKey[deleteSeenKey] || 0)) {
          latestCommunityDeleteSeenByKey[deleteSeenKey] = latest
        }
      },
      error => {
        if (controller.signal.aborted || communityDeleteLoadController !== controller) return

        clearTimeout(timeout)
        communityDeleteLoadController = null
        maintenanceAdmission.settle(admissionKey, "deletes")
        console.warn("[community-deletes] Failed to load community delete events", error)
        scheduleRetry()
      },
    )

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  $effect(() => {
    void communityLiveRetryVersion

    if (!communityBackgroundHydrationReady) {
      stopCommunityLiveSubscription()
      return
    }

    const exactDefinition = $activeExactCommunityDefinition
    const relays = readableRelays
    const recovery = readRecovery

    if (
      !exactDefinition ||
      exactDefinition.pointer.address !== exactCommunity?.address ||
      relays.length === 0
    ) {
      stopCommunityLiveSubscription()
      return
    }

    const filters = buildCommunityLiveFilters({
      authorityDefinition: exactDefinition,
      admissionFormAddresses,
    })

    if (filters.length === 0) {
      stopCommunityLiveSubscription()
      return
    }

    // Key on the filter/community shape without relays. If it changes we
    // tear down and rebuild; if only the relay set changes we diff below.
    const filtersKey = `${$pubkey || ""}:${getCommunityLiveSubscriptionKey({
      communityPubkey: exactDefinition.pointer.address,
      relays: [],
      filters,
    })}`
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
      const releaseOwnership = registerCommunityLiveOwnership(exactDefinition.pointer.address, url)
      let failed = false
      let closedReason: string | undefined
      const subscription = {controller, releaseOwnership}
      communityLiveSubscriptionsByRelay.set(url, subscription)
      request({
        relays: [url],
        filters,
        lifetime: "live",
        signal: controller.signal,
        priority: RELAY_REQUEST_PRIORITY.live,
        owner: "community-core",
        onClosed: reason => {
          failed = true
          closedReason = reason
          controller.abort()
        },
        onDisconnect: () => {
          failed = true
        },
        onEose: () => recovery.record(url, "complete"),
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
          if (closedReason) recovery.closed(url, closedReason)
          else recovery.record(url, "disconnected")
          if (recovery.blocked(url)) return
          if (communityLiveRetryTimer) clearTimeout(communityLiveRetryTimer)
          communityLiveRetryTimer = setTimeout(
            () => {
              communityLiveRetryTimer = null
              communityLiveRetryVersion += 1
            },
            recovery.delay([url]),
          )
        })
    }
  })

  onDestroy(() => {
    maintenanceAdmission.reset()
    stopCommunityHistoryLoad()
    stopCommunityDeleteLoad()
    stopCommunityFollowUpLoad()
    stopCommunityLiveSubscription()
    if (communityDeleteSeenKey) {
      setCheckedAt(
        communityDeleteSeenKey,
        Math.max(
          lastCommunityDeleteSeen,
          latestCommunityDeleteSeenByKey[communityDeleteSeenKey] || 0,
        ),
      )
    }
  })
</script>

{#if exactCommunity}
  <SecondaryNav>
    <CommunityMenu community={exactCommunity} evidenceReady={communityMaintenanceAdmission.menu} />
  </SecondaryNav>
  {#if !hasInlineCommunityMenu}
    <button
      type="button"
      class="btn btn-neutral btn-sm fixed right-[calc(var(--sair)+0.75rem)] top-[calc(var(--sait)+0.75rem)] z-nav lg:hidden"
      aria-label="Open community menu"
      style:top={`calc(var(--sait) + ${connection ? connectionHeight : 0}px + 0.75rem)`}
      onclick={openCommunityMenu}>
      <Icon icon={MenuDots} />
    </button>
  {/if}
{/if}

<Page class={pageClass}>
  {#if connection}
    <div
      class="cw top-sai fixed z-nav max-h-[40vh] overflow-auto bg-base-200"
      bind:clientHeight={connectionHeight}>
      {@render connection()}
    </div>
  {/if}
  <div
    class:community-connection-content={Boolean(connection)}
    style:--community-connection-height={`${connectionHeight}px`}>
    {#if !exactCommunity}
      <div class="content p-4">
        <h1 class="text-2xl font-bold">Invalid community</h1>
        <p>Use a valid community link.</p>
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
  </div>
</Page>
