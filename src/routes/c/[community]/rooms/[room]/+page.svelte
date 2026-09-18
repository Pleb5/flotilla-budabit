<script lang="ts">
  import {readable, type Readable} from "svelte/store"
  import {onDestroy, tick, untrack} from "svelte"
  import {page} from "$app/stores"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById, throttled} from "@welshman/store"
  import {formatTimestampAsDate, int, MINUTE, now} from "@welshman/lib"
  import type {EventContent, TrustedEvent} from "@welshman/util"
  import {makeEvent, matchFilters, MESSAGE, THREAD} from "@welshman/util"
  import {fade, fly} from "@lib/transition"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import RoomCompose from "@app/components/RoomCompose.svelte"
  import RoomComposeEdit from "@app/components/RoomComposeEdit.svelte"
  import RoomComposeParent from "@app/components/RoomComposeParent.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import RoomImage from "@app/components/RoomImage.svelte"
  import RoomItem from "@app/components/RoomItem.svelte"
  import RoomName from "@app/components/RoomName.svelte"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDescriptor,
    activeCommunityProfileListEvents,
    activeExactCommunityRelays,
    activeExactCommunityPublishRelays,
    activeCommunityReportState,
    activeExactCommunitySession,
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
    COMMUNITY_PRIORITY_RELAY_AUTH_TIMEOUT,
    getCommunityBootstrapKey,
    hydrateCommunityEventsWithStatus,
    recoverCommunityBootstrap,
    recoverCommunityRelayAuth,
    type CommunityHydrationStatus,
  } from "@app/core/community-state"
  import {
    makeCommunityContentFilterPlan,
    makeCommunityExclusiveFilter,
    makeCommunityRoomMessagesFilter,
  } from "@app/core/community-feeds"
  import {makeCommunityRoomMessage, readCommunityRoomMessages} from "@app/core/community-messages"
  import {isCommunityRoomLookupIncomplete, readCommunityRoomRoot} from "@app/core/community-rooms"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunityWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {
    getCommunityCensorReason,
    getCommunityReportEventAddress,
    isCommunityPersonBanned,
  } from "@app/core/community-reports"
  import {makeFeed} from "@app/core/requests"
  import {userSettingsValues} from "@app/core/state"
  import {prependParent} from "@app/core/commands"
  import {
    canEditMessageEvent,
    editedTargetIds,
    filterVisibleAfterDeletesAndEdits,
  } from "@app/core/event-edits"
  import {publishEditedMessage} from "@app/core/event-edit-publish"
  import {
    isPublicationPreviewVisible,
    publicationOperations,
    startPublication,
  } from "@app/core/publication-operations"
  import {
    checked,
    effectiveCommunityNotificationBaselines,
    getNotificationCheckedAt,
    setChecked,
  } from "@app/util/notifications"
  import {popKey} from "@lib/implicit"
  import {waitAndScrollToEvent} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {recoverActiveNip46Receiver} from "@app/util/nip46"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {
    activeCommunityRoomLoad,
    clearActiveCommunityRoomLoad,
  } from "@app/core/community-foreground"
  import {
    makeExactCommunityPath,
    makeExactCommunityRoomPath,
    parseExactCommunityRouteParam,
  } from "@app/util/routes"

  type RoomElement =
    | {type: "new-messages"; id: string}
    | {type: "date"; id: string; value: string; showPubkey: false}
    | {
        type: "note"
        id: string
        value: TrustedEvent
        showPubkey: boolean
        operationId?: string
      }

  const FEED_EMPTY_SETTLE_TIMEOUT_MS = 10_000
  const ROOM_LOAD_RETRY_DELAYS_MS = [5_000, 10_000, 20_000]

  const community = $derived(parseExactCommunityRouteParam($page.params.community))
  const communityOwnerPubkey = $derived(community?.ownerPubkey || "")
  const communityId = $derived(community?.communityId || "")
  const communityAddress = $derived(community?.address || "")
  const roomId = $derived($page.params.room || "")
  const mounted = now()
  const roomPath = $derived(
    community && roomId ? makeExactCommunityRoomPath(community, roomId) : $page.url.pathname,
  )
  const roomStateKey = $derived(communityAddress && roomId ? `${communityAddress}:${roomId}` : "")
  const expectedCommunityBootstrapKey = $derived.by(() => {
    const session = $activeExactCommunitySession

    return communityAddress &&
      $activeExactCommunityPointer?.address === communityAddress &&
      session?.definition.ownerPubkey === communityOwnerPubkey
      ? getCommunityBootstrapKey(session, $pubkey || "")
      : ""
  })
  const lastChecked = $derived.by(() =>
    getNotificationCheckedAt({
      checked: $checked,
      path: roomPath,
      currentPubkey: $pubkey || undefined,
      communityBaselines: $effectiveCommunityNotificationBaselines,
    }),
  )

  const roomAuthorPubkeys = $derived(
    $activeExactCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeExactCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.roomRoot,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const messageAuthorPubkeys = $derived(
    $activeExactCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeExactCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.roomMessage,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const commentAuthorPubkeys = $derived(
    $activeExactCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeExactCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.comment,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const reactionAuthorPubkeys = $derived(
    $activeExactCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeExactCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.reaction,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const reportAuthorPubkeys = $derived(
    $activeExactCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeExactCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.report,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityAddress &&
      $activeExactCommunityDefinition?.pointer.address === communityAddress &&
      $activeExactCommunityDefinition.ownerPubkey === communityOwnerPubkey &&
      expectedCommunityBootstrapKey &&
      $activeCommunityBootstrapStatus.key === expectedCommunityBootstrapKey &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading &&
      !$activeCommunityBootstrapStatus.error,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(
      communityAddress &&
      !communityBootstrapReady &&
      ($activeCommunityBootstrapStatus.key !== expectedCommunityBootstrapKey ||
        !$activeCommunityBootstrapStatus.error),
    ),
  )
  const communityAuthorityReadiness = $derived(
    $activeExactCommunityPointer?.address === communityAddress &&
      $activeCommunityDescriptor?.community.address === communityAddress
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
  const communityBootstrapFailed = $derived(
    Boolean(
      communityAddress &&
      expectedCommunityBootstrapKey &&
      $activeCommunityBootstrapStatus.key === expectedCommunityBootstrapKey &&
      !communityBootstrapReady &&
      $activeCommunityBootstrapStatus.error,
    ),
  )
  const roomRootSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityAuthorityReady ? $activeExactCommunityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.roomRoot,
    ),
  )
  const roomMessageSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityAuthorityReady ? $activeExactCommunityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.roomMessage,
    ),
  )
  const roomMessageAccessMessage = $derived(
    `Request ${roomMessageSectionName} access to message this room.`,
  )
  const roomFilterPlan = $derived(
    communityAuthorityReady && communityId && roomId
      ? makeCommunityContentFilterPlan(
          [makeCommunityExclusiveFilter(communityId, [THREAD], {ids: [roomId]})],
          roomAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const roomFilters = $derived(roomFilterPlan.localFilters)
  const roomRelayFilters = $derived(roomFilterPlan.relayFilters)
  const roomEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: roomFilters})))
  const room = $derived(
    communityAuthorityReady && $roomEvents[0]
      ? readCommunityRoomRoot($roomEvents[0], communityId)
      : undefined,
  )
  const roomCensorReason = $derived.by(() =>
    communityId && roomId
      ? getCommunityCensorReason({
          reportState: $activeCommunityReportState,
          eventId: room?.event.id || roomId,
          eventAddress: room ? getCommunityReportEventAddress(room.event) : "",
          pubkey: room?.event.pubkey,
          sectionName: roomRootSectionName,
        })
      : undefined,
  )
  const messageFilterPlan = $derived(
    communityAuthorityReady && communityId && room && !roomCensorReason
      ? makeCommunityContentFilterPlan(
          [makeCommunityRoomMessagesFilter(communityId, room.id)],
          messageAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const messageFilters = $derived(messageFilterPlan.localFilters)
  const messageRelayFilters = $derived(messageFilterPlan.relayFilters)
  const repositoryMessageEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: messageFilters})),
  )
  const canSendMessage = $derived(
    Boolean(
      room &&
      communityAuthorityReady &&
      !roomCensorReason &&
      $pubkey &&
      $activeExactCommunityDefinition &&
      canWriteCommunityTarget({
        definition: $activeExactCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const canReact = $derived(
    Boolean(
      room &&
      communityAuthorityReady &&
      !roomCensorReason &&
      $pubkey &&
      $activeExactCommunityDefinition &&
      canWriteCommunityTarget({
        definition: $activeExactCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.reaction,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const feedKey = $derived.by(() =>
    communityAddress &&
    communityAuthorityReady &&
    room &&
    !roomCensorReason &&
    messageAuthorPubkeys.length &&
    $activeExactCommunityRelays.length
      ? [communityAddress, room.id, ...$activeExactCommunityRelays, ...messageAuthorPubkeys].join(
          "|",
        )
      : "",
  )
  const composeUrl = $derived($activeExactCommunityRelays[0] || communityOwnerPubkey)

  const replyTo = (event: TrustedEvent) => {
    parent = event
    compose?.focus()
  }

  const clearParent = () => {
    parent = undefined
  }

  const clearShare = () => {
    share = undefined
  }

  const clearEventToEdit = () => {
    eventToEdit = undefined
  }

  const onSubmit = async ({content, tags}: EventContent) => {
    const trimmed = content.trim()
    if (!trimmed || !communityId || !communityAddress || !roomId) return false
    if (!room) {
      pushToast({theme: "error", message: "Room metadata is not loaded yet."})
      return false
    }
    if (!canSendMessage) {
      pushToast({theme: "error", message: roomMessageAccessMessage})
      return false
    }

    const relays = $activeExactCommunityPublishRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return false
    }

    if (eventToEdit) {
      try {
        await publishEditedMessage({
          event: eventToEdit,
          content: trimmed,
          tags,
          relays,
          url: communityAddress,
          delay: $userSettingsValues.send_delay,
        })
      } catch (error) {
        pushToast({
          theme: "error",
          message: error instanceof Error ? error.message : "Failed to publish edit.",
        })
        return false
      }

      clearParent()
      clearShare()
      clearEventToEdit()
      void pinToBottomAfterLayout()
      return true
    }

    let template: EventContent = makeCommunityRoomMessage({
      communityPubkey: communityId,
      room: {id: room.id, creatorPubkey: room.creatorPubkey},
      relay: relays[0],
      content: trimmed,
      tags,
      parent: parent ? {id: parent.id, pubkey: parent.pubkey, relay: relays[0]} : undefined,
    })

    if (share) {
      template = prependParent(share, template, {relays})
    }

    if (parent) {
      template = prependParent(parent, template, {relays})
    }

    try {
      startPublication({
        relays,
        event: makeEvent(MESSAGE, template),
        delay: $userSettingsValues.send_delay,
        label: "Room message",
        href: roomPath,
        semanticKey: `room-message:${communityAddress}:${room.id}`,
        preview: "retain-on-failure",
      })
    } catch (error) {
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Failed to send message.",
      })
      return false
    }

    clearParent()
    clearShare()
    clearEventToEdit()
    void pinToBottomAfterLayout()
    return true
  }

  const onScroll = () => {
    showScrollButton = Math.abs(element?.scrollTop || 0) > 1500

    if (!newMessages || newMessagesSeen) {
      showFixedNewMessages = false
    } else {
      const {y} = newMessages.getBoundingClientRect()

      if (y > 300) {
        newMessagesSeen = true
      } else {
        showFixedNewMessages = y < 0
      }
    }
  }

  const scrollToNewMessages = () => {
    cancelHashTargetStabilization()
    newMessages?.scrollIntoView({behavior: "smooth", block: "center"})
  }

  const scrollToBottom = () => {
    cancelHashTargetStabilization()
    element?.scrollTo({top: 0, behavior: "smooth"})
  }

  const waitForAnimationFrame = () =>
    new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

  const pinToBottomAfterLayout = async () => {
    cancelHashTargetStabilization()
    await tick()
    await waitForAnimationFrame()
    await waitForAnimationFrame()
    element?.scrollTo({top: 0, behavior: "auto"})
  }

  const clearFeedEmptySettleTimer = () => {
    if (!feedEmptySettleTimer) return

    clearTimeout(feedEmptySettleTimer)
    feedEmptySettleTimer = undefined
  }

  const startFeedEmptySettleTimer = () => {
    clearFeedEmptySettleTimer()
    feedEmptySettled = false
    feedEmptySettleTimer = setTimeout(() => {
      feedEmptySettleTimer = undefined
      feedEmptySettled = true
    }, FEED_EMPTY_SETTLE_TIMEOUT_MS)
  }

  const clearRoomAutoRetry = (resetAttempts = true) => {
    if (roomAutoRetryTimer) clearTimeout(roomAutoRetryTimer)
    roomAutoRetryTimer = undefined
    roomAutoRetryScheduled = false
    if (resetAttempts) roomAutoRetryAttempt = 0
  }

  const clearMessageAutoRetry = (resetAttempts = true) => {
    if (messageAutoRetryTimer) clearTimeout(messageAutoRetryTimer)
    messageAutoRetryTimer = undefined
    messageAutoRetryScheduled = false
    if (resetAttempts) messageAutoRetryAttempt = 0
  }

  const resetFeed = ({preserveRetryState = false}: {preserveRetryState?: boolean} = {}) => {
    if (!preserveRetryState) clearMessageAutoRetry()
    feedCleanup?.()
    feedCleanup = undefined
    clearFeedEmptySettleTimer()
    events = readable([])
    loadingEvents = false
    feedLoadStatus = "idle"
    feedEmptySettled = false
    exhaustedEvents = false
    feedInitialized = false
    lastFeedKey = ""
  }

  const startFeed = (key: string) => {
    if (
      !element ||
      !key ||
      messageFilters.length === 0 ||
      messageRelayFilters.length === 0 ||
      $activeExactCommunityRelays.length === 0
    )
      return

    loadingEvents = true
    feedLoadStatus = "loading"
    startFeedEmptySettleTimer()
    exhaustedEvents = false
    newMessagesSeen = false
    showFixedNewMessages = false
    lastFeedKey = key
    feedInitialized = true

    const feed = makeFeed({
      element,
      relays: $activeExactCommunityRelays,
      feedFilters: messageFilters,
      relayFilters: messageRelayFilters,
      subscriptionFilters: messageFilters,
      initialLoadTimeoutMs: FEED_EMPTY_SETTLE_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.foreground,
      owner: `active-room:${communityAddress}:${roomId}`,
      onInitialLoad: ({complete}) => {
        loadingEvents = false
        feedLoadStatus = complete ? "complete" : "incomplete"
        if (complete) clearMessageAutoRetry()
      },
      onExhausted: () => {
        clearMessageAutoRetry()
        loadingEvents = false
        feedLoadStatus = "complete"
        feedEmptySettled = true
        clearFeedEmptySettleTimer()
        exhaustedEvents = true
      },
    })

    // Throttle live event bursts so the message pipeline (visibility filtering,
    // grouping, full list rebuild) does not rerun per inserted event.
    events = throttled(300, feed.events)
    feedCleanup = feed.cleanup
  }

  const onEscape = () => {
    clearParent()
    clearShare()
    clearEventToEdit()
  }

  const canEditEvent = (event: TrustedEvent) => canEditMessageEvent(event, $pubkey, canSendMessage)

  const onEditEvent = (event: TrustedEvent) => {
    clearParent()
    clearShare()
    eventToEdit = event
  }

  const onEditPrevious = () => {
    const prev = filterVisibleAfterDeletesAndEdits($events, $editedTargetIds).find(
      e => e.pubkey === $pubkey,
    )

    if (prev && canEditEvent(prev)) {
      onEditEvent(prev)
    }
  }

  let loadingRoom = $state(false)
  let roomLoadStatus = $state<CommunityHydrationStatus>("idle")
  let roomLoadRetryVersion = $state(0)
  let retryingRoomLookup = $state(false)
  let retryingMessageFeed = $state(false)
  let roomAutoRetryAttempt = $state(0)
  let roomAutoRetryScheduled = $state(false)
  let messageAutoRetryAttempt = $state(0)
  let messageAutoRetryScheduled = $state(false)
  let loadingEvents = $state(false)
  let feedLoadStatus = $state<CommunityHydrationStatus>("idle")
  let feedEmptySettled = $state(false)
  let exhaustedEvents = $state(false)
  let share = $state(popKey<TrustedEvent | undefined>("share"))
  let parent: TrustedEvent | undefined = $state()
  let element: HTMLElement | undefined = $state()
  let newMessages: HTMLElement | undefined = $state()
  let chatCompose: HTMLElement | undefined = $state()
  let dynamicPadding: HTMLElement | undefined = $state()
  let newMessagesSeen = false
  let showFixedNewMessages = $state(false)
  let showScrollButton = $state(false)
  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let compose: RoomCompose | undefined = $state()
  let eventToEdit: TrustedEvent | undefined = $state()
  let feedCleanup: (() => void) | undefined = $state()
  let feedInitialized = $state(false)
  let feedEmptySettleTimer: ReturnType<typeof setTimeout> | undefined
  let roomAutoRetryTimer: ReturnType<typeof setTimeout> | undefined
  let messageAutoRetryTimer: ReturnType<typeof setTimeout> | undefined
  let hashTargetLoadController: AbortController | undefined
  let lastFeedKey = ""
  let lastRoomRetryPath = ""
  let hashTargetRoomPath = ""
  let hashTargetRequest = 0
  let hashTargetStabilizationUntil = $state(0)
  let hashTarget = $state({id: "", request: 0})
  let hashTargetEvents = $state<TrustedEvent[]>([])
  let loadedHashTargetKey = ""
  let revealingHashTargetKey = ""
  let revealedHashTargetKey = ""

  const cancelHashTargetStabilization = () => {
    hashTargetStabilizationUntil = 0
  }

  const scrollToRoomTarget = (
    id: string,
    root: NonNullable<Parameters<typeof waitAndScrollToEvent>[1]>["root"],
    signal?: AbortSignal,
  ) => waitAndScrollToEvent(id, {root, signal, behavior: "auto"})
  const waitingForRoom = $derived(
    Boolean(
      communityAuthorityReady &&
      !room &&
      roomFilters.length > 0 &&
      $activeExactCommunityRelays.length > 0 &&
      (loadingRoom ||
        roomLoadStatus === "idle" ||
        roomLoadStatus === "queued" ||
        roomLoadStatus === "loading"),
    ),
  )
  const waitingForFeed = $derived(Boolean(room && feedKey && !feedInitialized))
  const roomLookupNeedsRecovery = $derived(
    isCommunityRoomLookupIncomplete({
      roomFound: Boolean(room),
      bootstrapFailed: communityBootstrapFailed,
      permissionEvidenceIncomplete: communityAuthorityUnavailable,
      loadStatus: roomLoadStatus,
    }),
  )
  const roomRecoveryActive = $derived(retryingRoomLookup || roomAutoRetryScheduled || loadingRoom)
  const roomLookupIncomplete = $derived(
    communityAuthorityUnavailable ||
      (roomLookupNeedsRecovery &&
        !roomRecoveryActive &&
        roomAutoRetryAttempt >= ROOM_LOAD_RETRY_DELAYS_MS.length),
  )
  const recoveringRoomLookup = $derived(
    roomLookupNeedsRecovery && !communityAuthorityUnavailable && !roomLookupIncomplete,
  )

  const messageEventCandidates = $derived.by(() => {
    const eventsById = new Map<string, TrustedEvent>()

    for (const operation of $publicationOperations.values()) {
      if (operation.ownerPubkey !== $pubkey || !isPublicationPreviewVisible(operation)) continue
      if (!messageAuthorPubkeys.includes(operation.event.pubkey)) continue
      if (!readCommunityRoomMessages([operation.event], communityId, roomId).length) continue

      eventsById.set(operation.event.id, operation.event as TrustedEvent)
    }

    if (communityAuthorityReady && room) {
      for (const event of hashTargetEvents) {
        if (messageAuthorPubkeys.includes(event.pubkey)) eventsById.set(event.id, event)
      }
    }
    for (const event of $repositoryMessageEvents) {
      if (event.created_at >= mounted) eventsById.set(event.id, event)
    }
    for (const event of $events) eventsById.set(event.id, event)

    return Array.from(eventsById.values()).sort((a, b) => b.created_at - a.created_at)
  })
  const messageOperationIds = $derived.by(() => {
    const operationIds = new Map<string, string>()

    for (const operation of $publicationOperations.values()) {
      if (operation.ownerPubkey !== $pubkey || !isPublicationPreviewVisible(operation)) continue
      if (!messageAuthorPubkeys.includes(operation.event.pubkey)) continue
      if (!readCommunityRoomMessages([operation.event], communityId, roomId).length) continue

      operationIds.set(operation.event.id, operation.operationId)
    }

    return operationIds
  })
  const messages = $derived(
    readCommunityRoomMessages(
      filterVisibleAfterDeletesAndEdits(messageEventCandidates, $editedTargetIds),
      communityId,
      roomId,
    ).filter(item => !isCommunityPersonBanned($activeCommunityReportState, item.event.pubkey)),
  )
  const elements = $derived.by(() => {
    const nextElements: RoomElement[] = []
    const seen = new Set<string>()

    let previousDate
    let previousPubkey
    let previousCreatedAt = 0
    let hasSeenNewMessages = false

    const lastUserEvent = messages.find(e => e.event.pubkey === $pubkey)?.event
    const adjustedLastChecked =
      lastChecked && lastUserEvent ? Math.max(lastUserEvent.created_at, lastChecked) : lastChecked

    for (const item of messages.toReversed()) {
      const event = item.event
      if (seen.has(event.id)) continue

      const date = formatTimestampAsDate(event.created_at)

      if (
        !hasSeenNewMessages &&
        adjustedLastChecked &&
        event.pubkey !== $pubkey &&
        event.created_at > adjustedLastChecked &&
        event.created_at < mounted
      ) {
        nextElements.push({type: "new-messages", id: "new-messages"})
        hasSeenNewMessages = true
      }

      if (date !== previousDate) {
        nextElements.push({type: "date", value: date, id: date, showPubkey: false})
      }

      nextElements.push({
        id: event.id,
        type: "note",
        value: event,
        operationId: messageOperationIds.get(event.id),
        showPubkey:
          previousPubkey !== event.pubkey || event.created_at - previousCreatedAt > int(3, MINUTE),
      })

      previousDate = date
      previousPubkey = event.pubkey
      previousCreatedAt = event.created_at
      seen.add(event.id)
    }

    nextElements.reverse()

    return nextElements
  })

  const syncHashTarget = () => {
    const match = window.location.hash.match(/^#event-([0-9a-f]{64})$/i)
    const id = match?.[1]?.toLowerCase() || ""
    hashTargetLoadController?.abort()
    hashTargetLoadController = undefined
    revealingHashTargetKey = ""
    cancelHashTargetStabilization()
    hashTargetEvents = id ? hashTargetEvents.filter(event => event.id === id) : []
    hashTarget = {id, request: ++hashTargetRequest}
  }

  $effect(() => {
    if (typeof window === "undefined") return

    untrack(syncHashTarget)
    window.addEventListener("hashchange", syncHashTarget)

    return () => window.removeEventListener("hashchange", syncHashTarget)
  })

  $effect(() => {
    const {id, request} = hashTarget
    if (hashTargetRoomPath !== roomStateKey) {
      hashTargetLoadController?.abort()
      hashTargetLoadController = undefined
      hashTargetEvents = []
      loadedHashTargetKey = ""
      revealingHashTargetKey = ""
      revealedHashTargetKey = ""
      cancelHashTargetStabilization()
      hashTargetRoomPath = roomStateKey
    }

    const targetKey = `${roomStateKey}:${request}:${id}`
    const targetIsLoaded =
      room?.event.id === id || elements.some(item => item.type === "note" && item.id === id)

    if (!id) return

    const localFilters = messageFilters.map(filter => ({...filter, ids: [id], limit: 1}))
    const relayFilters = messageRelayFilters.map(filter => ({...filter, ids: [id], limit: 1}))
    const cachedTarget = repository.getEvent(id) as TrustedEvent | undefined
    if (
      !targetIsLoaded &&
      cachedTarget &&
      room &&
      localFilters.length > 0 &&
      communityAuthorityReady &&
      matchFilters(localFilters, cachedTarget) &&
      !hashTargetEvents.some(event => event.id === id) &&
      readCommunityRoomMessages([cachedTarget], communityId, roomId).length > 0
    ) {
      hashTargetEvents = [cachedTarget]
      return
    }

    if (targetIsLoaded) {
      if (revealedHashTargetKey === targetKey || revealingHashTargetKey === targetKey) return

      hashTargetLoadController?.abort()
      const controller = new AbortController()
      hashTargetLoadController = controller
      revealingHashTargetKey = targetKey

      void tick()
        .then(() => {
          if (controller.signal.aborted || hashTarget.request !== request) return false

          const root = room?.event.id === id ? document : element
          if (!root) return false

          return scrollToRoomTarget(id, root, controller.signal)
        })
        .then(revealed => {
          if (revealed && !controller.signal.aborted && hashTarget.request === request) {
            revealedHashTargetKey = targetKey
            hashTargetStabilizationUntil = Date.now() + 5_000
          }
        })
        .finally(() => {
          if (revealingHashTargetKey === targetKey) revealingHashTargetKey = ""
          if (hashTargetLoadController === controller) hashTargetLoadController = undefined
        })
      return
    }

    const relays = $activeExactCommunityRelays
    const loadKey = `${targetKey}:${relays.join("|")}:${JSON.stringify({localFilters, relayFilters})}`
    if (relays.length === 0 || localFilters.length === 0 || relayFilters.length === 0) {
      hashTargetLoadController?.abort()
      hashTargetLoadController = undefined
      return
    }
    if (loadedHashTargetKey === loadKey) return

    loadedHashTargetKey = loadKey
    hashTargetLoadController?.abort()
    const controller = new AbortController()
    const requestedRoomStateKey = roomStateKey
    hashTargetLoadController = controller

    void hydrateCommunityEventsWithStatus({
      key: `room-hash-target:${loadKey}`,
      relays,
      filters: relayFilters,
      authenticate: true,
      timeout: FEED_EMPTY_SETTLE_TIMEOUT_MS,
      authTimeout: COMMUNITY_PRIORITY_RELAY_AUTH_TIMEOUT,
      settle: "first-non-empty",
      priority: RELAY_REQUEST_PRIORITY.interactive,
      signal: controller.signal,
    }).then(result => {
      if (
        controller.signal.aborted ||
        hashTarget.request !== request ||
        roomStateKey !== requestedRoomStateKey ||
        loadedHashTargetKey !== loadKey
      )
        return

      const targetEvents = result.events.filter(
        event =>
          event.id === id &&
          room &&
          communityAuthorityReady &&
          matchFilters(localFilters, event) &&
          readCommunityRoomMessages([event], communityId, roomId).length > 0,
      )
      if (targetEvents.length > 0) {
        hashTargetEvents = [...hashTargetEvents.filter(event => event.id !== id), ...targetEvents]
      }
    })
  })

  // Older feed batches can shift an off-feed target after its first reveal.
  // Re-center during a bounded window unless the user starts interacting.
  $effect(() => {
    const {id, request} = hashTarget
    void elements.length
    const targetKey = `${roomStateKey}:${request}:${id}`
    const root = element
    const stabilizationUntil = hashTargetStabilizationUntil
    const remaining = stabilizationUntil - Date.now()

    if (!id || !root || revealedHashTargetKey !== targetKey || remaining <= 0) return

    const recenterTimer = setTimeout(() => {
      if (
        hashTarget.request !== request ||
        revealedHashTargetKey !== targetKey ||
        hashTargetStabilizationUntil !== stabilizationUntil
      )
        return

      void scrollToRoomTarget(id, root)
    }, 350)
    const disarmTimer = setTimeout(() => {
      if (hashTargetStabilizationUntil === stabilizationUntil) cancelHashTargetStabilization()
    }, remaining)

    return () => {
      clearTimeout(recenterTimer)
      clearTimeout(disarmTimer)
    }
  })

  // Re-evaluate scroll indicators after the rendered element list changes.
  // Kept outside the derived so building the list stays side-effect free.
  $effect(() => {
    void elements
    const timer = setTimeout(onScroll, 100)

    return () => clearTimeout(timer)
  })

  $effect(() => {
    void roomLoadRetryVersion

    const relays = $activeExactCommunityRelays
    if (
      !communityAddress ||
      !roomId ||
      relays.length === 0 ||
      roomFilters.length === 0 ||
      roomRelayFilters.length === 0
    ) {
      loadingRoom = false
      roomLoadStatus = "idle"
      return
    }

    if (room) {
      loadingRoom = false
      roomLoadStatus = "complete"
      return
    }

    const controller = new AbortController()
    loadingRoom = true
    roomLoadStatus = "queued"
    void hydrateCommunityEventsWithStatus({
      key: `room:${roomStateKey}:${roomLoadRetryVersion}:${JSON.stringify({localFilters: roomFilters, relayFilters: roomRelayFilters})}`,
      relays,
      filters: roomRelayFilters,
      authenticate: true,
      timeout: FEED_EMPTY_SETTLE_TIMEOUT_MS,
      authTimeout: COMMUNITY_PRIORITY_RELAY_AUTH_TIMEOUT,
      priority: RELAY_REQUEST_PRIORITY.foreground,
      signal: controller.signal,
      onStatus: status => {
        roomLoadStatus = status
        loadingRoom = status === "queued" || status === "loading"
      },
    })

    return () => controller.abort()
  })

  $effect(() => {
    if (elements.length === 0) return

    clearMessageAutoRetry()
    loadingEvents = false
    if (feedLoadStatus !== "incomplete" && feedLoadStatus !== "failed") {
      feedLoadStatus = "complete"
    }
    feedEmptySettled = true
    clearFeedEmptySettleTimer()
  })

  const retryRoomLookup = async ({automatic = false}: {automatic?: boolean} = {}) => {
    if (retryingRoomLookup) return

    if (!automatic) clearRoomAutoRetry()

    const session =
      $activeExactCommunityPointer?.address === communityAddress
        ? $activeExactCommunitySession
        : undefined
    if (!session) return

    retryingRoomLookup = true
    loadingRoom = true
    roomLoadStatus = "queued"

    try {
      await recoverActiveNip46Receiver().catch(() => false)
      await recoverCommunityBootstrap(session, {
        recoverAuth: true,
      })
    } catch (error) {
      console.warn("[community-room] Failed to recover room metadata", error)
    } finally {
      roomLoadRetryVersion += 1
      retryingRoomLookup = false
    }
  }

  const retryMessageFeed = async ({automatic = false}: {automatic?: boolean} = {}) => {
    if (retryingMessageFeed) return

    if (!automatic) clearMessageAutoRetry()
    retryingMessageFeed = true
    try {
      await recoverActiveNip46Receiver().catch(() => false)
      await Promise.allSettled(
        $activeExactCommunityRelays.map(relay => recoverCommunityRelayAuth(relay)),
      )
      resetFeed({preserveRetryState: automatic})
    } finally {
      retryingMessageFeed = false
    }
  }

  const scheduleRoomAutoRetry = () => {
    if (
      roomAutoRetryTimer ||
      retryingRoomLookup ||
      roomAutoRetryAttempt >= ROOM_LOAD_RETRY_DELAYS_MS.length
    )
      return

    const delay = ROOM_LOAD_RETRY_DELAYS_MS[roomAutoRetryAttempt]
    roomAutoRetryAttempt += 1
    roomAutoRetryScheduled = true
    roomAutoRetryTimer = setTimeout(() => {
      roomAutoRetryTimer = undefined
      roomAutoRetryScheduled = false
      void retryRoomLookup({automatic: true})
    }, delay)
  }

  const scheduleMessageAutoRetry = () => {
    if (
      messageAutoRetryTimer ||
      retryingMessageFeed ||
      messageAutoRetryAttempt >= ROOM_LOAD_RETRY_DELAYS_MS.length
    )
      return

    const delay = ROOM_LOAD_RETRY_DELAYS_MS[messageAutoRetryAttempt]
    messageAutoRetryAttempt += 1
    messageAutoRetryScheduled = true
    messageAutoRetryTimer = setTimeout(() => {
      messageAutoRetryTimer = undefined
      messageAutoRetryScheduled = false
      void retryMessageFeed({automatic: true})
    }, delay)
  }

  const messageFeedNeedsRecovery = $derived(
    Boolean(
      room &&
      elements.length === 0 &&
      (feedLoadStatus === "incomplete" || feedLoadStatus === "failed"),
    ),
  )
  const messageRecoveryActive = $derived(
    retryingMessageFeed || messageAutoRetryScheduled || loadingEvents,
  )
  const messageFeedFailureVisible = $derived(
    messageFeedNeedsRecovery &&
      !messageRecoveryActive &&
      messageAutoRetryAttempt >= ROOM_LOAD_RETRY_DELAYS_MS.length,
  )
  const recoveringMessageFeed = $derived(messageFeedNeedsRecovery && !messageFeedFailureVisible)
  const roomContentStatus = $derived.by(() => {
    if (
      communityBootstrapLoading ||
      communityAuthorityLoading ||
      waitingForRoom ||
      recoveringRoomLookup
    ) {
      return "loading"
    }
    if (roomLookupIncomplete) return "room-incomplete"
    if (!room) return "room-missing"
    if (waitingForFeed || loadingEvents || recoveringMessageFeed) return "loading"
    if (messageFeedFailureVisible) return "feed-incomplete"
    if (!feedEmptySettled && elements.length === 0) return "loading"
    if (elements.length === 0) return "empty"
    if (exhaustedEvents) return "exhausted"
  })
  const foregroundRoomLoadSettled = $derived(
    Boolean(
      roomCensorReason ||
      elements.length > 0 ||
      (!room && (roomLoadStatus === "complete" || roomLookupIncomplete)) ||
      (room && feedInitialized && (feedLoadStatus === "complete" || messageFeedFailureVisible)),
    ),
  )

  $effect(() => {
    if (lastRoomRetryPath === roomStateKey) return

    lastRoomRetryPath = roomStateKey
    clearRoomAutoRetry()
  })

  $effect(() => {
    if (room) {
      clearRoomAutoRetry()
      return
    }

    if (roomLookupNeedsRecovery && !retryingRoomLookup) scheduleRoomAutoRetry()
  })

  $effect(() => {
    if (elements.length > 0 || feedLoadStatus === "complete") {
      clearMessageAutoRetry()
      return
    }

    if (messageFeedNeedsRecovery && !retryingMessageFeed) scheduleMessageAutoRetry()
  })

  $effect(() => {
    activeCommunityRoomLoad.set({
      communityAddress,
      roomId,
      pending: !foregroundRoomLoadSettled,
    })
  })

  $effect(() => {
    const key = feedKey

    if (!key || !element) {
      resetFeed()
      return
    }

    if (!feedInitialized) {
      startFeed(key)
    } else if (key !== lastFeedKey) {
      resetFeed()
      startFeed(key)
    }
  })

  $effect(() => {
    const checkedPath = roomPath

    return () => setChecked(checkedPath)
  })

  $effect(() => {
    const paddingElement = dynamicPadding
    const composeElement = chatCompose

    if (!paddingElement) return
    if (!composeElement) {
      paddingElement.style.minHeight = "0px"
      return
    }

    const update = () => {
      paddingElement.style.minHeight = `${composeElement.offsetHeight}px`
    }
    const observer = new ResizeObserver(update)

    observer.observe(composeElement)
    update()

    return () => observer.disconnect()
  })

  onDestroy(() => {
    hashTargetLoadController?.abort()
    clearRoomAutoRetry()
    clearMessageAutoRetry()
    clearActiveCommunityRoomLoad(communityAddress, roomId)
    resetFeed()
  })
</script>

<PageBar
  showTopMenuWidgets={Boolean(room) ||
    roomLoadStatus === "complete" ||
    roomLoadStatus === "incomplete" ||
    roomLoadStatus === "failed"}>
  {#snippet icon()}
    <div class="row-2">
      <a href={community ? makeExactCommunityPath(community) : "#"} class="btn btn-neutral btn-sm">
        <Icon icon={AltArrowLeft} />
      </a>
      <div class="center hidden h-8 w-8 rounded-xl bg-base-200 sm:flex">
        {#if !roomCensorReason}
          <RoomImage {room} h={roomId} />
        {/if}
      </div>
    </div>
  {/snippet}
  {#snippet title()}
    <strong data-event={room?.event.id}>
      {#if roomCensorReason}
        Moderated room
      {:else}
        <RoomName {room} h={roomId} />
      {/if}
    </strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <CommunityMenuButton community={community?.naddr} />
    </div>
  {/snippet}
</PageBar>

{#if roomCensorReason}
  <PageContent class="p-4">
    <ModeratedContent reason={roomCensorReason} />
  </PageContent>
{:else}
  <PageContent
    bind:element
    onscroll={onScroll}
    onpointerdown={cancelHashTargetStabilization}
    ontouchstart={cancelHashTargetStabilization}
    onwheel={cancelHashTargetStabilization}
    class="flex flex-col-reverse pt-4">
    <div bind:this={dynamicPadding}></div>
    {#each elements as item (item.id)}
      {#if item.type === "new-messages"}
        <div
          bind:this={newMessages}
          class="flex items-center py-2 text-xs transition-colors"
          class:opacity-0={showFixedNewMessages}>
          <div class="h-px flex-grow bg-primary"></div>
          <p class="rounded-full bg-primary px-2 py-1 text-primary-content">New Messages</p>
          <div class="h-px flex-grow bg-primary"></div>
        </div>
      {:else if item.type === "date"}
        <Divider>{item.value}</Divider>
      {:else}
        {@const event = $state.snapshot(item.value as TrustedEvent)}
        <div class:-mt-1={!item.showPubkey}>
          <RoomItem
            url={communityOwnerPubkey}
            {community}
            profileRelays={$activeExactCommunityRelays}
            interactionRelays={$activeExactCommunityRelays}
            actionRelays={$activeExactCommunityPublishRelays}
            allowedAuthors={commentAuthorPubkeys}
            reactionAllowedAuthors={reactionAuthorPubkeys}
            reportAllowedAuthors={reportAuthorPubkeys}
            scopeH={communityId}
            communitySectionName={roomMessageSectionName}
            operationId={item.operationId}
            {event}
            readOnly={!canReact || Boolean(item.operationId)}
            {replyTo}
            showPubkey={item.showPubkey}
            canEdit={canEditEvent}
            onEdit={onEditEvent} />
        </div>
      {/if}
    {/each}
    {#if roomContentStatus}
      <p
        class="flex h-10 flex-col items-center justify-center gap-2 py-20 text-center"
        data-room-loading-stage={roomContentStatus === "loading" &&
        !communityBootstrapLoading &&
        communityAuthorityLoading
          ? "authority"
          : undefined}>
        {#if roomContentStatus === "loading"}
          <Spinner loading>Loading room...</Spinner>
        {:else if roomContentStatus === "room-incomplete"}
          <span>{communityAuthorityUnavailable ? "Room unavailable." : "Room not found."}</span>
        {:else if roomContentStatus === "room-missing"}
          <span>Room not found or not approved for this community.</span>
        {:else if roomContentStatus === "feed-incomplete"}
          <span>No messages yet.</span>
        {:else if roomContentStatus === "empty"}
          <span>No messages yet.</span>
        {:else if roomContentStatus === "exhausted"}
          <Spinner>End of message history</Spinner>
        {/if}
      </p>
    {/if}
  </PageContent>
{/if}

{#if !roomCensorReason && room}
  <div
    class="chat__compose bg-base-200"
    bind:this={chatCompose}
    onfocusin={cancelHashTargetStabilization}>
    {#if canSendMessage}
      <div>
        {#if parent}
          <RoomComposeParent event={parent} clear={clearParent} verb="Replying to" />
        {/if}
        {#if share}
          <RoomComposeParent event={share} clear={clearShare} verb="Sharing" />
        {/if}
        {#if eventToEdit}
          <RoomComposeEdit clear={clearEventToEdit} />
        {/if}
      </div>
      {#key eventToEdit}
        <RoomCompose
          url={composeUrl}
          h={communityId}
          blossomContext={{
            type: "community",
            communityAddress,
          }}
          showMenu={false}
          {onSubmit}
          {onEscape}
          {onEditPrevious}
          content={eventToEdit?.content}
          bind:this={compose} />
      {/key}
    {:else}
      <div
        class="m-3 flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-100 p-3 shadow-sm">
        <div class="min-w-0">
          <strong class="block text-sm">Access required</strong>
          <p class="text-xs opacity-70">{roomMessageAccessMessage}</p>
        </div>
        <PublishGate
          target={COMMUNITY_WRITE_TARGETS.roomMessage}
          action="message rooms"
          compact
          class="btn btn-primary" />
      </div>
    {/if}
  </div>
{/if}

{#if showScrollButton && !roomCensorReason}
  <div in:fade class="chat__scroll-down">
    <Button class="btn btn-circle btn-neutral" onclick={scrollToBottom}>
      <Icon icon={AltArrowDown} />
    </Button>
  </div>
{/if}

{#if showFixedNewMessages && !roomCensorReason}
  <div class="relative z-popover flex justify-center">
    <div transition:fly={{duration: 200}} class="fixed top-12">
      <Button class="btn btn-primary btn-xs rounded-full" onclick={scrollToNewMessages}>
        New Messages
      </Button>
    </div>
  </div>
{/if}
