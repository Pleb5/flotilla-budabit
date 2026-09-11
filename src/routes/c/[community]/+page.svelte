<script lang="ts">
  import {page} from "$app/stores"
  import {untrack} from "svelte"
  import {writable} from "svelte/store"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, type Filter, type TrustedEvent} from "@welshman/util"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Ghost from "@assets/icons/ghost-smile.svg?dataurl"
  import BillList from "@assets/icons/bill-list.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import StarFallMinimalistic from "@assets/icons/star-fall-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import Link from "@lib/components/Link.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Content from "@app/components/Content.svelte"
  import CommunityExtensionsPrompt from "@app/components/community/CommunityExtensionsPrompt.svelte"
  import CommunityHomeWidgetSlot from "@app/components/community/CommunityHomeWidgetSlot.svelte"
  import CommunityHomeWidgetRecovery from "@app/components/community/CommunityHomeWidgetRecovery.svelte"
  import CommunityRoomCreate from "@app/components/community/CommunityRoomCreate.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import CommunityStarButton from "@app/components/community/CommunityStarButton.svelte"
  import CommunityShareButton from "@app/components/community/CommunityShareButton.svelte"
  import PerformanceDiagnosticsStatus from "@app/components/PerformanceDiagnosticsStatus.svelte"
  import {PERFORMANCE_DIAGNOSTICS_ENABLED} from "@app/core/feature-flags"
  import {
    activePerformanceDiagnosticsRun,
    completeAutomaticPerformanceDiagnosticsCapture,
    markPerformanceDiagnosticsMilestone,
    recordPerformanceDiagnostics,
  } from "@app/core/performance-diagnostics"
  import PublicationStatus from "@app/components/PublicationStatus.svelte"
  import {fade} from "@lib/transition"
  import {normalizeRelays, parseAddressRef} from "@app/core/community"
  import {
    activeCommunityDescriptor,
    activeCommunityPermissionStatus,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
    activeExactCommunityRelays,
    hasCommunityHydrationCompleted,
    hydratePubkeyOutboxRelays,
    loadCommunityEvents,
    loadCommunityEventsWithStatus,
    markCommunityHydrationCompleted,
    resolveExactCommunityDefinition,
    setActiveExactCommunityDefinition,
    COMMUNITY_DISCOVERY_RELAYS,
  } from "@app/core/community-state"
  import {
    makeCommunityContentFilterPlan,
    makeCommunityRoomRootsFilter,
  } from "@app/core/community-feeds"
  import {readCommunityRoomRoots} from "@app/core/community-rooms"
  import {
    getCommunityModeratorInviteProfileListRefs,
    getPendingCommunityModeratorInvites,
    makeModeratorInviteResponseProfileList,
  } from "@app/core/community-admin"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {isCommunityPersonBanned} from "@app/core/community-reports"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {
    activeCommunityRoomLoad,
    clearActiveCommunityRoomLoad,
  } from "@app/core/community-foreground"
  import {loadBoundedCommunityHistory, type BoundedCommunityHistoryResult} from "@app/core/requests"
  import {publicationOperations, startPublication} from "@app/core/publication-operations"
  import {assertReplaceablePublicationIsCurrent} from "@app/core/replaceable-publication"
  import {getModeratorInviteResponseSemanticKey} from "@app/core/governance-publication-operations"
  import {
    isCompleteCommunityModeratorEvidence,
    type CommunityModeratorEvidenceStatus,
  } from "@app/extensions/community-home-readiness"
  import {
    emptyCommunityHomeWidgetRecoveryState,
    type CommunityHomeWidgetSlotInitialState,
  } from "@app/extensions/community-home-widget-recovery"
  import {notifications} from "@app/util/notifications"
  import {hasGitNotification} from "@app/util/repo-watch-notifications"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {formatShortNpub} from "@app/util/pubkeys"
  import {
    makeExactCommunityCalendarPath,
    makeExactCommunityGoalPath,
    makeExactCommunityRoomPath,
    makeExactCommunityThreadPath,
    makeExactGitCommunityEntryPath,
  } from "@app/util/routes"

  const communityPointer = $derived($activeExactCommunityPointer)
  const homeWidgetRecovery = writable(emptyCommunityHomeWidgetRecoveryState())
  let widgetSlotInitialStates = $state<Record<string, CommunityHomeWidgetSlotInitialState>>({})
  const setWidgetSlotInitialState = (state: CommunityHomeWidgetSlotInitialState) => {
    widgetSlotInitialStates[state.slotType] = state
  }
  $effect(() => {
    void communityPointer?.address
    widgetSlotInitialStates = {}
  })
  const routeCommunityDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityPointer?.address
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const ownerPubkey = $derived(communityPointer?.ownerPubkey || "")
  const communityId = $derived(communityPointer?.communityId || "")
  const shortCommunity = $derived(formatShortNpub(ownerPubkey) || "Unknown community")
  const communityName = $derived(routeCommunityDefinition?.metadata.name || shortCommunity)
  const communityDescription = $derived(routeCommunityDefinition?.metadata.description || "")
  const communityDescriptionEvent = $derived({content: communityDescription, tags: []})
  const communityPicture = $derived(routeCommunityDefinition?.metadata.picture || "")
  let failedPicture = $state("")
  let retryingCommunityBootstrap = $state(false)
  const showCommunityPicture = $derived(
    Boolean(communityPicture && failedPicture !== communityPicture),
  )
  const mainRelay = $derived(
    routeCommunityDefinition?.relays[0] || communityPointer?.relayHints[0] || "",
  )
  const homeWidgetRelayHints = $derived($activeExactCommunityRelays)
  const threadsPath = $derived(
    communityPointer ? makeExactCommunityThreadPath(communityPointer) : "",
  )
  const calendarPath = $derived(
    communityPointer ? makeExactCommunityCalendarPath(communityPointer) : "",
  )
  const goalsPath = $derived(communityPointer ? makeExactCommunityGoalPath(communityPointer) : "")
  const gitPath = $derived(
    communityPointer ? makeExactGitCommunityEntryPath(communityPointer) : "/git",
  )
  const communityDefinitionReady = $derived(Boolean(communityPointer && routeCommunityDefinition))
  const expectedCommunityBootstrapKey = $derived(communityPointer?.address || "")
  const retryCommunityBootstrap = async () => {
    const pointer = $activeExactCommunityPointer
    if (!pointer || retryingCommunityBootstrap) return

    retryingCommunityBootstrap = true

    try {
      const definition = await resolveExactCommunityDefinition(pointer, {
        discoveryRelays: COMMUNITY_DISCOVERY_RELAYS,
        hydrateOwnerOutbox: hydratePubkeyOutboxRelays,
        loadEvents: (relays, filters) => loadCommunityEvents(relays, filters, {timeout: 3000}),
      })
      if (definition && $activeExactCommunityPointer?.address === pointer.address) {
        setActiveExactCommunityDefinition(definition)
      }
    } catch (error) {
      console.warn("[community-home] Failed to retry community bootstrap", error)
    } finally {
      retryingCommunityBootstrap = false
    }
  }
  const roomAuthorPubkeys = $derived(
    routeCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: routeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.roomRoot,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const communityBootstrapReady = $derived(Boolean(communityPointer && routeCommunityDefinition))
  const communityAuthorityReadiness = $derived(
    communityPointer && $activeCommunityDescriptor?.community.address === communityPointer.address
      ? $activeCommunityDescriptor.authorityReadiness.state
      : "loading",
  )
  const communityAuthorityLoading = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "loading",
  )
  const communityAuthorityReady = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "ready",
  )
  const communityAuthorityUnavailable = $derived(communityAuthorityReadiness === "unavailable")
  // Short settle window: hide the "Community unavailable" banner for a brief
  // moment after entering a community so a fast bootstrap or an incoming
  // cached definition never causes an error flash.
  const COMMUNITY_UNAVAILABLE_SETTLE_MS = 1_200
  let communityUnavailableSettleReady = $state(false)
  $effect(() => {
    // Reset the settle gate whenever the community changes.
    void communityPointer?.address
    communityUnavailableSettleReady = false

    const timer = setTimeout(() => {
      communityUnavailableSettleReady = true
    }, COMMUNITY_UNAVAILABLE_SETTLE_MS)

    return () => clearTimeout(timer)
  })
  const showCommunityUnavailable = $derived(
    Boolean(communityPointer && communityAuthorityUnavailable && communityUnavailableSettleReady),
  )
  const roomFilterPlan = $derived(
    communityDefinitionReady && communityAuthorityReady && communityId
      ? makeCommunityContentFilterPlan(
          [makeCommunityRoomRootsFilter(communityId)],
          roomAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const roomFilters = $derived(roomFilterPlan.localFilters)
  const roomRelayFilters = $derived(roomFilterPlan.relayFilters)
  const roomEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: roomFilters})))
  const rooms = $derived(
    communityAuthorityReady
      ? readCommunityRoomRoots($roomEvents, communityId).filter(
          room => !isCommunityPersonBanned($activeCommunityReportState, room.event.pubkey),
        )
      : [],
  )
  const canCreateRoom = $derived(
    Boolean(
      $pubkey &&
      communityAuthorityReady &&
      routeCommunityDefinition &&
      canWriteCommunityTarget({
        definition: routeCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.roomRoot,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const createRoomPermissionLoading = $derived(Boolean(communityAuthorityLoading && !canCreateRoom))
  const communityHomeCoreReady = $derived(
    Boolean(communityPointer && routeCommunityDefinition && communityAuthorityReady),
  )
  let moderatorInviteEvidenceState = $state<{
    key: string
    status: CommunityModeratorEvidenceStatus
    events: TrustedEvent[]
  }>({key: "", status: "unresolved", events: []})
  let moderatorInviteEvidenceLoadKey = ""
  let moderatorInviteEvidenceRetryKey = ""
  let moderatorInviteEvidenceRetryCount = 0
  let moderatorInviteEvidenceRetryNonce = $state(0)
  let moderatorInviteEvidenceRetryTimer: ReturnType<typeof setTimeout> | undefined
  const moderatorInviteProfileListEvents = $derived([
    ...$activeCommunityProfileListEvents,
    ...moderatorInviteEvidenceState.events,
  ])
  const pendingModeratorInvites = $derived.by(() => {
    return getPendingCommunityModeratorInvites({
      definition: routeCommunityDefinition as any,
      moderatorPubkey: $pubkey || undefined,
      profileListEvents: moderatorInviteProfileListEvents,
    })
  })
  const moderatorInviteOperationIds = $derived.by(() => {
    const operationIds = new Map<string, string>()

    for (const invite of pendingModeratorInvites) {
      const semanticKey = getModeratorInviteResponseSemanticKey(invite.profileList.address)
      const operation = Array.from($publicationOperations.values()).find(
        candidate =>
          candidate.ownerPubkey === $pubkey &&
          candidate.semanticKey === semanticKey &&
          (candidate.phase === "publishing" || candidate.phase === "unconfirmed"),
      )

      if (operation) operationIds.set(invite.profileList.address, operation.operationId)
    }

    return operationIds
  })
  const startableModeratorInvites = $derived(
    pendingModeratorInvites.filter(
      invite => !moderatorInviteOperationIds.has(invite.profileList.address),
    ),
  )
  const moderatorInviteProfileListRefs = $derived.by(() =>
    getCommunityModeratorInviteProfileListRefs({
      definition: routeCommunityDefinition as any,
      moderatorPubkey: $pubkey || undefined,
    }),
  )
  const moderatorInviteEvidenceExpectedKey = $derived.by(() => {
    const definition = routeCommunityDefinition
    const user = $pubkey || ""
    const refs = Array.from(new Set(moderatorInviteProfileListRefs.map(ref => ref.address))).sort()
    const relays = normalizeRelays($activeExactCommunityRelays)

    return communityHomeCoreReady && definition && user && refs.length > 0 && relays.length > 0
      ? JSON.stringify({
          bootstrapKey: expectedCommunityBootstrapKey,
          permissionKey: $activeCommunityPermissionStatus.key,
          viewer: user,
          communityAddress: communityPointer!.address,
          definition: definition.event.id,
          relays,
          addresses: refs,
        })
      : ""
  })
  const showPendingModeratorInvites = $derived(
    communityAuthorityReadiness === "ready" &&
      isCompleteCommunityModeratorEvidence(
        moderatorInviteEvidenceExpectedKey,
        moderatorInviteEvidenceState,
      ) &&
      pendingModeratorInvites.length > 0,
  )
  const MODERATOR_INVITE_EVIDENCE_TIMEOUT_MS = 2_000
  const MODERATOR_INVITE_EVIDENCE_RETRY_DELAY_MS = 5_000
  const MODERATOR_INVITE_EVIDENCE_RETRY_LIMIT = 2
  const ROOM_ROOT_LOAD_TIMEOUT_MS = 8_000
  const ROOM_ROOT_EMPTY_RETRY_DELAY_MS = 2_000
  const ROOM_ROOT_EMPTY_RETRY_LIMIT = 2
  let roomRootsLoading = $state(false)
  let roomRootsLoaded = $state(false)
  let roomRootsComplete = $state(false)
  let roomRootsIncomplete = $state(false)
  let roomRootsFirstAttemptKey = $state("")
  let roomRootsFirstAttemptTerminal = $state(false)
  let roomLoadKey = ""
  let roomLoadHydrationKey = ""
  let roomLoadRetryNonce = $state(0)
  let roomLoadEmptyRetries = 0
  let roomLoadRetryTimer: ReturnType<typeof setTimeout> | undefined
  const roomCatalogReadinessKey = $derived(
    communityHomeCoreReady
      ? JSON.stringify({
          communityAddress: communityPointer!.address,
          bootstrapKey: expectedCommunityBootstrapKey,
          permissionKey: $activeCommunityPermissionStatus.key,
          relays: normalizeRelays($activeExactCommunityRelays),
          filters: roomFilters,
          relayFilters: roomRelayFilters,
        })
      : "",
  )
  const communityHomeExtensionsReady = $derived(
    Boolean(
      communityHomeCoreReady &&
      (rooms.length > 0 ||
        (roomCatalogReadinessKey &&
          roomRootsFirstAttemptKey === roomCatalogReadinessKey &&
          roomRootsFirstAttemptTerminal)),
    ),
  )
  const widgetCatalogInitialTerminal = $derived(
    $homeWidgetRecovery.curatedFirstAttemptTerminal &&
      $homeWidgetRecovery.sharedConfigFirstAttemptTerminal,
  )
  const widgetSlotStates = $derived([
    widgetSlotInitialStates["community-home-before-quicklinks"],
    widgetSlotInitialStates["community-home-after-quicklinks"],
  ])
  const widgetInitialFrameCount = $derived(
    widgetSlotStates.reduce((total, state) => total + (state?.frameCount || 0), 0),
  )
  const widgetInitialLoadedCount = $derived(
    widgetSlotStates.reduce((total, state) => total + (state?.loadedCount || 0), 0),
  )
  const widgetInitialResolvedCount = $derived(
    widgetSlotStates.reduce((total, state) => total + (state?.resolvedCount || 0), 0),
  )
  const widgetInitialTerminal = $derived(
    widgetCatalogInitialTerminal && widgetSlotStates.every(state => Boolean(state?.terminal)),
  )
  $effect(() => {
    const communityAddress = communityPointer?.address || ""
    if (!communityAddress) return

    activeCommunityRoomLoad.set({
      communityAddress,
      roomId: "",
      pending: !(
        roomCatalogReadinessKey &&
        roomRootsFirstAttemptKey === roomCatalogReadinessKey &&
        roomRootsFirstAttemptTerminal
      ),
    })

    return () => clearActiveCommunityRoomLoad(communityAddress, "")
  })
  const roomsWaitingForDefinition = $derived(
    Boolean(
      communityPointer &&
      (!communityDefinitionReady || !communityBootstrapReady) &&
      !showCommunityUnavailable,
    ),
  )
  const roomsUnavailable = $derived(
    Boolean(
      communityPointer &&
      ((!communityDefinitionReady && showCommunityUnavailable) || communityAuthorityUnavailable),
    ),
  )
  const roomsWaitingForRequest = $derived(
    Boolean(roomFilters.length > 0 && (roomRootsLoading || !roomRootsLoaded)),
  )
  const roomsWaitingForPermissions = $derived(
    Boolean(
      communityAuthorityLoading &&
      communityDefinitionReady &&
      rooms.length === 0 &&
      roomFilters.length === 0,
    ),
  )
  const roomsLoading = $derived(
    roomsWaitingForDefinition || roomsWaitingForRequest || roomsWaitingForPermissions,
  )
  // Let fast bootstrap phases settle without showing a card. Once it is shown,
  // keep it visible through definition/permission/request handoffs instead of
  // restarting the delay. Cached rooms stop it; a later load gets a fresh delay.
  const ROOMS_SKELETON_DELAY_MS = 800
  const roomsPendingKey = $derived(
    communityPointer && rooms.length === 0 && roomsLoading ? communityPointer.address : "",
  )
  let roomsSkeletonVisibleKey = $state("")
  const roomsSkeletonDelayElapsed = $derived(
    Boolean(roomsPendingKey && roomsSkeletonVisibleKey === roomsPendingKey),
  )
  $effect(() => {
    const key = roomsPendingKey
    void roomsWaitingForPermissions
    if (key && untrack(() => roomsSkeletonVisibleKey) === key) return

    roomsSkeletonVisibleKey = ""
    if (!key) return

    const timer = setTimeout(() => {
      roomsSkeletonVisibleKey = key
    }, ROOMS_SKELETON_DELAY_MS)
    return () => clearTimeout(timer)
  })
  const roomsSettledEmpty = $derived(
    Boolean(
      communityPointer &&
      rooms.length === 0 &&
      roomFilters.length > 0 &&
      roomRootsLoaded &&
      roomRootsComplete &&
      !roomRootsLoading &&
      !roomsWaitingForDefinition &&
      !roomsUnavailable,
    ),
  )
  let performanceRunId = ""
  let performanceSettlementScheduledRunId = ""
  const performanceMilestones = new Set<string>()
  const markPerformanceMilestone = (name: string, detail?: unknown) => {
    const active = $activePerformanceDiagnosticsRun
    if (!PERFORMANCE_DIAGNOSTICS_ENABLED || !active || active.route !== $page.url.pathname) return
    if (active.id !== performanceRunId) {
      performanceRunId = active.id
      performanceMilestones.clear()
      performanceSettlementScheduledRunId = ""
    }
    if (performanceMilestones.has(name)) return
    performanceMilestones.add(name)
    markPerformanceDiagnosticsMilestone(active.id, name, detail)
  }
  const schedulePerformanceSettlement = (runId: string) => {
    if (performanceSettlementScheduledRunId === runId) return
    performanceSettlementScheduledRunId = runId
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const active = $activePerformanceDiagnosticsRun
        if (!active || active.id !== runId || !widgetInitialTerminal) {
          if (performanceSettlementScheduledRunId === runId) {
            performanceSettlementScheduledRunId = ""
          }
          return
        }
        markPerformanceMilestone("home-initial-painted")
        markPerformanceMilestone("settled", {
          rooms: rooms.length,
          widgetFrames: widgetInitialFrameCount,
          widgetFramesLoaded: widgetInitialLoadedCount,
          widgetFramesResolved: widgetInitialResolvedCount,
        })
        completeAutomaticPerformanceDiagnosticsCapture(runId)
      })
    })
  }
  $effect(() => {
    const active = $activePerformanceDiagnosticsRun
    const communityAddress = communityPointer?.address || ""
    if (!active || active.route !== $page.url.pathname || !communityAddress) return

    markPerformanceMilestone("route-mounted", {communityAddress})
    recordPerformanceDiagnostics(active.id, "community-state", {
      communityAddress,
      definitionReady: communityDefinitionReady,
      authorityReadiness: communityAuthorityReadiness,
      roomRootsLoading,
      roomRootsLoaded,
      roomRootsComplete,
      roomRootsIncomplete,
      rooms: rooms.length,
      curatedWidgetCandidates: $homeWidgetRecovery.curatedWidgets.length,
      widgetCatalogInitialTerminal,
      widgetInitialFrameCount,
      widgetInitialLoadedCount,
      widgetInitialResolvedCount,
    })
    if (communityDefinitionReady) markPerformanceMilestone("definition-ready")
    if (communityAuthorityReady) markPerformanceMilestone("authority-ready")
    if (roomRootsLoading) markPerformanceMilestone("rooms-requested")
    if (rooms.length > 0) markPerformanceMilestone("rooms-present", {count: rooms.length})
    if (roomRootsFirstAttemptTerminal) {
      markPerformanceMilestone("rooms-terminal", {
        complete: roomRootsComplete,
        incomplete: roomRootsIncomplete,
        count: rooms.length,
      })
    }
    if (communityHomeExtensionsReady) markPerformanceMilestone("home-core-ready")
    if ($homeWidgetRecovery.curatedFirstAttemptTerminal) {
      markPerformanceMilestone("widget-curation-first-terminal", {
        complete: $homeWidgetRecovery.curatedFirstAttemptComplete,
        candidates: $homeWidgetRecovery.curatedWidgets.length,
      })
    }
    if ($homeWidgetRecovery.sharedConfigFirstAttemptTerminal) {
      markPerformanceMilestone("widget-shared-config-first-terminal", {
        complete: $homeWidgetRecovery.sharedConfigFirstAttemptComplete,
        events: $homeWidgetRecovery.sharedConfigEvents.length,
      })
    }
    if (widgetCatalogInitialTerminal) {
      markPerformanceMilestone("widget-catalog-initial-terminal", {
        curatedCandidates: $homeWidgetRecovery.curatedWidgets.length,
        sharedConfigEvents: $homeWidgetRecovery.sharedConfigEvents.length,
      })
    }
    if ($homeWidgetRecovery.curatedWidgets.length > 0) {
      markPerformanceMilestone("widget-candidates-present", {
        count: $homeWidgetRecovery.curatedWidgets.length,
      })
    }
    if (widgetInitialFrameCount > 0) {
      markPerformanceMilestone("widget-frames-selected", {count: widgetInitialFrameCount})
    }
    if (widgetInitialLoadedCount > 0) {
      markPerformanceMilestone("widget-first-frame-loaded", {count: widgetInitialLoadedCount})
    }
    if (widgetInitialFrameCount > 0 && widgetInitialLoadedCount === widgetInitialFrameCount) {
      markPerformanceMilestone("widget-all-frames-loaded", {count: widgetInitialLoadedCount})
    }
    if (widgetInitialTerminal) {
      markPerformanceMilestone("widget-initial-layout-terminal", {
        frames: widgetInitialFrameCount,
        loaded: widgetInitialLoadedCount,
        resolved: widgetInitialResolvedCount,
      })
      schedulePerformanceSettlement(active.id)
    }
  })

  const clearRoomLoadRetry = () => {
    if (!roomLoadRetryTimer) return

    clearTimeout(roomLoadRetryTimer)
    roomLoadRetryTimer = undefined
  }

  const scheduleRoomLoadRetry = () => {
    if (roomLoadRetryTimer || roomLoadEmptyRetries >= ROOM_ROOT_EMPTY_RETRY_LIMIT) return false

    roomLoadEmptyRetries += 1
    roomRootsLoading = true
    roomRootsLoaded = false
    roomLoadRetryTimer = setTimeout(() => {
      roomLoadRetryTimer = undefined
      roomLoadKey = ""
      roomLoadRetryNonce += 1
    }, ROOM_ROOT_EMPTY_RETRY_DELAY_MS * roomLoadEmptyRetries)

    return true
  }

  const clearModeratorInviteEvidenceRetry = () => {
    if (!moderatorInviteEvidenceRetryTimer) return

    clearTimeout(moderatorInviteEvidenceRetryTimer)
    moderatorInviteEvidenceRetryTimer = undefined
  }

  const scheduleModeratorInviteEvidenceRetry = (key: string) => {
    if (
      moderatorInviteEvidenceRetryTimer ||
      moderatorInviteEvidenceRetryCount >= MODERATOR_INVITE_EVIDENCE_RETRY_LIMIT
    ) {
      return
    }

    moderatorInviteEvidenceRetryCount += 1
    moderatorInviteEvidenceRetryTimer = setTimeout(() => {
      moderatorInviteEvidenceRetryTimer = undefined
      if (moderatorInviteEvidenceExpectedKey !== key) return

      moderatorInviteEvidenceLoadKey = ""
      moderatorInviteEvidenceRetryNonce += 1
    }, MODERATOR_INVITE_EVIDENCE_RETRY_DELAY_MS * moderatorInviteEvidenceRetryCount)
  }

  const createRoom = () => {
    if (communityPointer) pushModal(CommunityRoomCreate, {community: communityPointer})
  }

  const respondToModeratorInvite = (declined: boolean) => {
    const invites = Array.from(
      new Map(
        startableModeratorInvites.map(invite => [invite.profileList.address, invite]),
      ).values(),
    )
    if (invites.length === 0) return

    const relays = routeCommunityDefinition?.relays || []
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community definition must declare at least one relay."})
      return
    }

    pushModal(Confirm, {
      title: declined ? "Decline moderation request" : "Accept moderation request",
      message: declined
        ? `Are you sure you decline moderator role in ${communityName} community?`
        : `Do you really accept moderator role in ${communityName} community?`,
      confirm: () => {
        let started = 0
        let startError: unknown

        for (const invite of invites) {
          const response = makeModeratorInviteResponseProfileList({
            profileList: invite.profileList,
            declined,
          })

          try {
            startPublication({
              relays,
              event: makeEvent(response.kind, response),
              label: `Moderator response for ${invite.displayName}`,
              href: $page.url.pathname,
              semanticKey: getModeratorInviteResponseSemanticKey(invite.profileList.address),
              preview: "none",
              validateRetry: assertReplaceablePublicationIsCurrent,
            })
            started += 1
          } catch (error) {
            startError ||= error
          }
        }

        if (startError) {
          pushToast({
            theme: "error",
            message:
              startError instanceof Error
                ? startError.message
                : "Failed to publish a moderator response.",
          })
        }
        if (started > 0) history.back()
      },
    })
  }

  $effect(() => {
    void moderatorInviteEvidenceRetryNonce
    const refs = Array.from(
      new Map(moderatorInviteProfileListRefs.map(ref => [ref.address, ref])).values(),
    ).sort((a, b) => a.address.localeCompare(b.address))
    const relays = normalizeRelays($activeExactCommunityRelays)
    const key = moderatorInviteEvidenceExpectedKey

    if (!key) {
      clearModeratorInviteEvidenceRetry()
      moderatorInviteEvidenceLoadKey = ""
      moderatorInviteEvidenceRetryKey = ""
      moderatorInviteEvidenceRetryCount = 0
      moderatorInviteEvidenceState = {key: "", status: "unresolved", events: []}
      return
    }

    if (moderatorInviteEvidenceRetryKey !== key) {
      clearModeratorInviteEvidenceRetry()
      moderatorInviteEvidenceRetryKey = key
      moderatorInviteEvidenceRetryCount = 0
    }

    const requestKey = `${key}:${moderatorInviteEvidenceRetryNonce}`
    if (moderatorInviteEvidenceLoadKey === requestKey) return

    moderatorInviteEvidenceLoadKey = requestKey
    moderatorInviteEvidenceState = {key, status: "loading", events: []}
    const controller = new AbortController()

    const filters = refs.flatMap(ref => {
      const address = parseAddressRef(ref.address)
      return address
        ? [
            {
              kinds: [address.kind],
              authors: [address.pubkey],
              "#d": [address.identifier],
              limit: 1,
            } satisfies Filter,
          ]
        : []
    })

    loadCommunityEventsWithStatus(relays, filters, {
      authenticate: true,
      priorityAuthRelays: relays,
      timeout: MODERATOR_INVITE_EVIDENCE_TIMEOUT_MS,
      settle: "all",
      signal: controller.signal,
    })
      .then(result => {
        if (
          controller.signal.aborted ||
          moderatorInviteEvidenceLoadKey !== requestKey ||
          moderatorInviteEvidenceExpectedKey !== key
        ) {
          return
        }

        moderatorInviteEvidenceState = {
          key,
          status: result.complete ? "complete" : "unresolved",
          events: result.events,
        }
        if (!result.complete) scheduleModeratorInviteEvidenceRetry(key)
      })
      .catch(error => {
        if (controller.signal.aborted || moderatorInviteEvidenceLoadKey !== requestKey) return

        moderatorInviteEvidenceState = {key, status: "unresolved", events: []}
        scheduleModeratorInviteEvidenceRetry(key)
        console.warn("[community-home] Failed to hydrate moderator invite evidence", error)
      })

    return () => {
      clearModeratorInviteEvidenceRetry()
      controller.abort()
    }
  })

  $effect(() => {
    const key = roomCatalogReadinessKey

    if (!key) {
      roomRootsLoading = false
      roomRootsComplete = false
      roomRootsIncomplete = false
      roomRootsFirstAttemptKey = ""
      roomRootsFirstAttemptTerminal = false
      roomLoadKey = ""
      roomLoadHydrationKey = ""
      roomLoadEmptyRetries = 0
      roomRootsLoaded = false
      clearRoomLoadRetry()
      return
    }

    const catalog = JSON.parse(key) as {
      communityAddress: string
      relays: string[]
      filters: Filter[]
      relayFilters: Filter[]
    }
    const relays = catalog.relays
    const filters = catalog.filters
    const relayFilters = catalog.relayFilters

    if (roomLoadHydrationKey !== key) {
      roomLoadHydrationKey = key
      roomLoadEmptyRetries = 0
      roomRootsFirstAttemptKey = key
      roomRootsFirstAttemptTerminal = false
      clearRoomLoadRetry()
      roomLoadRetryNonce = 0
    }

    if (relays.length === 0 || filters.length === 0 || relayFilters.length === 0) {
      roomLoadKey = key
      roomRootsLoading = false
      roomRootsLoaded = true
      roomRootsComplete = filters.length === 0
      roomRootsIncomplete = !roomRootsComplete
      roomRootsFirstAttemptTerminal = true
      clearRoomLoadRetry()
      return
    }

    const requestKey = `${key}:${roomLoadRetryNonce}`

    if (roomLoadKey === requestKey) return
    if (hasCommunityHydrationCompleted(key)) {
      roomLoadKey = requestKey
      roomRootsLoading = false
      roomRootsLoaded = true
      roomRootsComplete = true
      roomRootsIncomplete = false
      roomRootsFirstAttemptTerminal = true
      clearRoomLoadRetry()
      return
    }

    const controller = new AbortController()
    let disposed = false

    roomLoadKey = requestKey
    roomRootsLoading = true
    roomRootsLoaded = false
    roomRootsIncomplete = false

    const finishRoomLoad = (result: BoundedCommunityHistoryResult) => {
      if (disposed || roomLoadKey !== requestKey) return

      roomRootsFirstAttemptTerminal = true

      const loadedRooms = readCommunityRoomRoots(result.events, communityId).filter(
        room => !isCommunityPersonBanned($activeCommunityReportState, room.event.pubkey),
      )
      const hasLoadedRooms = loadedRooms.length > 0 || rooms.length > 0

      if (hasLoadedRooms) {
        roomRootsComplete = result.complete
        roomRootsIncomplete = !roomRootsComplete
        if (roomRootsComplete) markCommunityHydrationCompleted(key)
        clearRoomLoadRetry()
        roomRootsLoading = false
        roomRootsLoaded = true
        return
      }

      const shouldRetryEmpty = roomLoadEmptyRetries === 0 || !result.complete
      if (shouldRetryEmpty && scheduleRoomLoadRetry()) return

      roomRootsComplete = result.complete
      roomRootsIncomplete = !roomRootsComplete
      if (roomRootsComplete) markCommunityHydrationCompleted(key)
      roomRootsLoading = false
      roomRootsLoaded = true
    }

    loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters: filters,
      priority: RELAY_REQUEST_PRIORITY.community,
      owner: `community-home-rooms:${catalog.communityAddress}`,
      timeoutMs: ROOM_ROOT_LOAD_TIMEOUT_MS,
      signal: controller.signal,
    })
      .then(finishRoomLoad)
      .catch(error => {
        if (!controller.signal.aborted) console.warn("[community-home] Failed to load rooms", error)
        finishRoomLoad({events: [], complete: false, timedOut: false, saturated: false})
      })

    return () => {
      disposed = true
      clearRoomLoadRetry()
      controller.abort()
    }
  })
</script>

<PageBar showTopMenuWidgets={communityHomeExtensionsReady}>
  {#snippet icon()}
    <div class="center">
      <Icon icon={HomeSmile} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Home</strong>
  {/snippet}
  {#snippet action()}
    <PerformanceDiagnosticsStatus route={$page.url.pathname} />
    <CommunityMenuButton />
  {/snippet}
</PageBar>

<PageContent
  class="flex flex-col gap-2 p-2 pt-4"
  data-perf="community-home"
  data-perf-community={communityPointer?.address || ""}
  data-perf-core-ready={communityHomeCoreReady ? "true" : "false"}
  data-perf-extensions-ready={communityHomeExtensionsReady ? "true" : "false"}
  data-perf-widgets-terminal={widgetInitialTerminal ? "true" : "false"}
  data-perf-rooms={rooms.length}
  data-perf-widgets={$homeWidgetRecovery.curatedWidgets.length}>
  {#if communityPointer}
    {#key communityPointer.address}
      <CommunityHomeWidgetRecovery
        community={communityPointer}
        ready={communityHomeExtensionsReady}
        recoveryStore={homeWidgetRecovery} />
    {/key}
  {/if}
  <div class="card2 bg-alt relative flex flex-col items-center gap-4 text-left">
    {#if communityPointer}
      <div class="flex w-full justify-end gap-2">
        <CommunityShareButton
          value={communityPointer}
          definitionRelays={routeCommunityDefinition?.relays || []} />
        <CommunityStarButton
          community={communityPointer}
          publishRelayHints={routeCommunityDefinition?.relays || []} />
      </div>
    {/if}
    <div class="relative flex gap-4">
      <div class="relative">
        <div class="avatar relative">
          <div
            class="center !flex h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-solid border-base-300 bg-base-300 sm:h-20 sm:w-20">
            {#if showCommunityPicture}
              <img
                alt=""
                src={communityPicture}
                class="h-full w-full object-cover"
                onerror={() => (failedPicture = communityPicture)} />
            {:else}
              <Icon icon={Ghost} size={6} />
            {/if}
          </div>
        </div>
      </div>
      <div class="flex min-w-0 flex-col justify-center gap-1">
        <h1 class="ellipsize whitespace-nowrap text-2xl font-bold">{communityName}</h1>
        <p class="ellipsize text-sm opacity-75">{mainRelay || shortCommunity}</p>
      </div>
    </div>
    {#if communityDescription}
      <div class="w-full min-w-0 max-w-3xl break-words text-center md:text-xl">
        <Content event={communityDescriptionEvent} showEntire />
      </div>
    {/if}
    {#if routeCommunityDefinition?.terms}
      <div class="flex flex-wrap justify-center gap-3">
        {#if routeCommunityDefinition?.terms}
          <Link
            href={routeCommunityDefinition.terms.reference}
            class="badge badge-neutral flex gap-2">
            <Icon icon={BillList} size={4} />
            Terms
          </Link>
        {/if}
      </div>
    {/if}
  </div>

  {#if showCommunityUnavailable}
    <section class="card2 border-warning bg-warning/10 p-4 shadow-md">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-warning">Community unavailable</h2>
          <p class="mt-1 text-sm opacity-75">
            The community definition did not load. This can happen after a stale mobile connection
            or when relay auth is required.
          </p>
        </div>
        <Button
          class="btn btn-warning shrink-0 justify-center"
          disabled={retryingCommunityBootstrap}
          onclick={retryCommunityBootstrap}>
          {#if retryingCommunityBootstrap}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          Retry
        </Button>
      </div>
    </section>
  {/if}

  {#if showPendingModeratorInvites}
    <section class="card2 border-warning bg-warning/10 p-4 shadow-md">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-warning">
            You have been requested to moderate this group
          </h2>
          <p class="mt-1 text-sm opacity-75">
            Accepting publishes empty moderator lists owned by your key, making the role active and
            helping the community load faster for everyone.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            {#each pendingModeratorInvites as invite (`${invite.profileList.address}:${invite.sectionName}`)}
              <span class="badge badge-warning">{invite.displayName}</span>
            {/each}
          </div>
          {#each Array.from(new Set(moderatorInviteOperationIds.values())) as operationId (operationId)}
            <PublicationStatus {operationId} class="mt-3" />
          {/each}
        </div>
        <div class="grid shrink-0 grid-cols-1 gap-2 sm:w-40">
          <Button
            class="btn btn-warning justify-center"
            disabled={startableModeratorInvites.length === 0}
            onclick={() => respondToModeratorInvite(false)}>
            Accept
          </Button>
          <Button
            class="btn btn-ghost justify-center"
            disabled={startableModeratorInvites.length === 0}
            onclick={() => respondToModeratorInvite(true)}>
            Decline
          </Button>
        </div>
      </div>
    </section>
  {/if}

  {#if communityPointer && communityHomeExtensionsReady}
    {#key roomCatalogReadinessKey}
      <CommunityExtensionsPrompt relayHints={homeWidgetRelayHints} />

      <CommunityHomeWidgetSlot
        community={communityPointer}
        recovery={$homeWidgetRecovery}
        onInitialState={setWidgetSlotInitialState}
        slotType="community-home-before-quicklinks" />
    {/key}
  {/if}

  <div class="grid gap-2 max-sm:grid-cols-2 sm:grid-cols-3">
    <Link
      href={gitPath}
      class="btn border-none bg-[#0284c7] text-white hover:bg-[#0369a1] md:text-lg">
      <div class="relative flex items-center gap-2">
        <Icon icon={Git} />
        Git
        {#if hasGitNotification($notifications)}
          <div
            class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary-content"
            transition:fade>
          </div>
        {/if}
      </div>
    </Link>
    {#if threadsPath}
      <Link
        href={threadsPath}
        class="btn border-none bg-[#4f46e5] text-white hover:bg-[#4338ca] md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={NotesMinimalistic} size={6} />
          Threads
          {#if $notifications.has(threadsPath)}
            <div class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-white" transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
    {#if calendarPath}
      <Link
        href={calendarPath}
        class="btn border-none bg-[#c2410c] text-white hover:bg-[#9a3412] md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={CalendarMinimalistic} size={6} />
          Calendar
          {#if $notifications.has(calendarPath)}
            <div class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-white" transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
    {#if goalsPath}
      <Link
        href={goalsPath}
        class="btn border-none bg-[#a16207] text-white hover:bg-[#854d0e] md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={StarFallMinimalistic} />
          Goals
          {#if $notifications.has(goalsPath)}
            <div class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-white" transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
    {#each rooms as room (room.id)}
      {@const roomPath = makeExactCommunityRoomPath(communityPointer!, room.id)}
      <Link
        href={roomPath}
        class="btn btn-neutral relative border-base-content/15 shadow-sm hover:border-base-content/25">
        <div class="flex min-w-0 items-center gap-2 overflow-hidden text-nowrap md:text-lg">
          <Icon icon={Hashtag} />
          <span class="ellipsize">{room.name}</span>
        </div>
        {#if $notifications.has(roomPath)}
          <div class="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" transition:fade></div>
        {/if}
      </Link>
    {/each}
    {#if communityPointer && rooms.length === 0 && (roomsSkeletonDelayElapsed || !roomsLoading)}
      <div class="card2 bg-alt col-span-full flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h3 class="flex items-center gap-2 text-lg font-semibold">
            <Icon icon={Hashtag} />
            {roomsWaitingForPermissions
              ? "Loading Rooms..."
              : roomsLoading
                ? "Looking for rooms..."
                : roomsUnavailable
                  ? "Rooms unavailable"
                  : "No rooms found"}
          </h3>
          <p class="text-sm opacity-70">
            {roomsWaitingForPermissions
              ? "Loading community rooms."
              : roomsLoading
                ? "Loading community rooms."
                : roomsUnavailable
                  ? "Rooms could not be loaded."
                  : createRoomPermissionLoading
                    ? "Loading room actions."
                    : canCreateRoom && roomsSettledEmpty
                      ? "Create the first room for this community."
                      : "No rooms have been published yet."}
          </p>
        </div>
        {#if roomsUnavailable}
          <Button
            class="btn btn-neutral shrink-0 justify-center"
            disabled={retryingCommunityBootstrap}
            onclick={retryCommunityBootstrap}>
            {retryingCommunityBootstrap ? "Retrying..." : "Retry"}
          </Button>
        {:else if canCreateRoom && roomsSettledEmpty}
          <button class="btn btn-primary" type="button" onclick={createRoom}> Create Room </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if communityPointer && communityHomeExtensionsReady}
    {#key roomCatalogReadinessKey}
      <CommunityHomeWidgetSlot
        community={communityPointer}
        recovery={$homeWidgetRecovery}
        onInitialState={setWidgetSlotInitialState}
        slotType="community-home-after-quicklinks" />
    {/key}
  {/if}
</PageContent>
