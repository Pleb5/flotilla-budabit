<script lang="ts">
  import {onDestroy, tick} from "svelte"
  import {page} from "$app/stores"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {sortBy} from "@welshman/lib"
  import {
    COMMENT,
    getTagValue,
    matchFilters,
    makeEvent,
    type EventContent,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {scrollToEvent} from "@lib/html"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import RoomCompose from "@app/components/RoomCompose.svelte"
  import RoomComposeEdit from "@app/components/RoomComposeEdit.svelte"
  import RoomComposeParent from "@app/components/RoomComposeParent.svelte"
  import ChannelMessage from "@app/components/ChannelMessage.svelte"
  import CalendarEventActions from "@app/components/CalendarEventActions.svelte"
  import CalendarEventDescription from "@app/components/CalendarEventDescription.svelte"
  import CalendarEventHeader from "@app/components/CalendarEventHeader.svelte"
  import CalendarEventMeta from "@app/components/CalendarEventMeta.svelte"
  import CalendarEventDate from "@app/components/CalendarEventDate.svelte"
  import PublicationStatus from "@app/components/PublicationStatus.svelte"
  import {
    makeCommunityCalendarEventReply,
    readCommunityCalendarEventReply,
  } from "@app/core/community-calendar"
  import {isCalendarEventKind} from "@app/core/calendar-events"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDescriptor,
    activeExactCommunityDefinition,
    activeCommunityProfileListEvents,
    activeExactCommunityRelays,
    activeExactCommunityPublishRelays,
    activeCommunityReportState,
    type CommunityHydrationStatus,
  } from "@app/core/community-state"
  import {
    makeCommunityContentFilterPlan,
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilterPlan,
    makeTargetedPublicationOriginalRelayHintPlans,
  } from "@app/core/community-feeds"
  import {
    COMMUNITY_CALENDAR_WRITE_TARGETS,
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    filterAuthorizedCommunityTargetingEvents,
    filterAuthorizedLegacyCommunityTargetingEvents,
    getCommunityCalendarTargetWriterPubkeys,
    getCommunityCalendarWriteTargetSectionName,
    getCommunityWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {
    getCommunityCensorReason,
    getCommunityReportEventAddress,
    isCommunityPersonBanned,
  } from "@app/core/community-reports"
  import {
    canEditReplyEvent,
    editedTargetIds,
    filterVisibleAfterDeletesAndEdits,
  } from "@app/core/event-edits"
  import {publishEditedReply} from "@app/core/event-edit-publish"
  import {publicationOperations, startPublication} from "@app/core/publication-operations"
  import {projectAuthoredPublicationEvents} from "@app/core/authored-publication-operations"
  import {makeCommunityTargetedPublicationSemanticKey} from "@app/core/community-targeting"
  import {
    makeLegacyCommunityTargetingFilter,
    makeLegacyTargetedPublicationOriginalFilterPlan,
    makeLegacyTargetedPublicationOriginalRelayHintPlans,
  } from "@app/core/community-targeting-legacy"
  import {setChecked} from "@app/util/notifications"
  import {pushToast} from "@app/util/toast"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {loadBoundedCommunityHistory} from "@app/core/requests"
  import {makeExactCommunityCalendarPath, parseExactCommunityRouteParam} from "@app/util/routes"

  const REQUEST_HARD_TIMEOUT_MS = 10_000

  const routeCommunity = $derived(parseExactCommunityRouteParam($page.params.community))
  const communityOwnerPubkey = $derived(routeCommunity?.ownerPubkey || "")
  const communityId = $derived(routeCommunity?.communityId || "")
  const communityAddress = $derived(routeCommunity?.address || "")
  const communityDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityAddress
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const eventParam = $derived($page.params.event || "")
  const calendarPath = $derived(
    routeCommunity ? makeExactCommunityCalendarPath(routeCommunity) : $page.url.pathname,
  )
  const eventPath = $derived(
    routeCommunity && eventParam
      ? makeExactCommunityCalendarPath(routeCommunity, eventParam)
      : calendarPath,
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityAddress &&
      communityDefinition &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityAddress && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const communityAuthorityReadiness = $derived(
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
    Boolean(communityAddress && !communityBootstrapReady && $activeCommunityBootstrapStatus.error),
  )
  const calendarSectionName = $derived(
    getCommunityCalendarWriteTargetSectionName(
      communityAuthorityReady ? communityDefinition : undefined,
    ),
  )
  const getCalendarEventSectionName = (_kind: number) =>
    getCommunityCalendarWriteTargetSectionName(
      communityAuthorityReady ? communityDefinition : undefined,
    )
  const commentSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityAuthorityReady ? communityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.comment,
    ),
  )
  const commentAccessMessage = $derived(`Request ${commentSectionName} access to comment.`)
  const calendarWriterPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityCalendarTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const commentAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.comment,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const reactionAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.reaction,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const reportAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.report,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const isEventIdParam = $derived(/^[0-9a-f]{64}$/i.test(eventParam))
  const targetingFilterPlan = $derived.by(() => {
    const relayFilters: Filter[] = []
    const localFilters: Filter[] = []
    if (!communityAuthorityReady || !routeCommunity) return {relayFilters, localFilters}

    for (const target of COMMUNITY_CALENDAR_WRITE_TARGETS) {
      const plan = makeCommunityContentFilterPlan(
        [
          makeCommunityTargetingFilter(communityId, [target.kind]),
          ...(communityOwnerPubkey === communityId
            ? [makeLegacyCommunityTargetingFilter(communityId, [target.kind])]
            : []),
        ],
        calendarWriterPubkeys,
      )
      relayFilters.push(...plan.relayFilters)
      localFilters.push(...plan.localFilters)
    }

    return {relayFilters, localFilters}
  })
  const targetingFilters = $derived(targetingFilterPlan.localFilters)
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
  const authorizedTargetingEvents = $derived.by(() =>
    communityAuthorityReady && communityDefinition && routeCommunity
      ? filterAuthorizedCommunityTargetingEvents({
          community: routeCommunity,
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $targetingEvents,
          reportState: $activeCommunityReportState,
          kinds: COMMUNITY_CALENDAR_WRITE_TARGETS.map(target => target.kind),
        })
      : [],
  )
  const authorizedLegacyTargetingEvents = $derived.by(() =>
    communityAuthorityReady && communityDefinition && routeCommunity
      ? filterAuthorizedLegacyCommunityTargetingEvents({
          community: routeCommunity,
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $targetingEvents,
          reportState: $activeCommunityReportState,
          kinds: COMMUNITY_CALENDAR_WRITE_TARGETS.map(target => target.kind),
        })
      : [],
  )
  const targetedEventFilterPlan = $derived.by(() => {
    const current = makeTargetedPublicationOriginalFilterPlan(authorizedTargetingEvents)
    const legacy = makeLegacyTargetedPublicationOriginalFilterPlan(authorizedLegacyTargetingEvents)

    return {
      relayFilters: [...current.relayFilters, ...legacy.relayFilters],
      localFilters: [...current.localFilters, ...legacy.localFilters],
    }
  })
  const targetedEventRelayHintPlans = $derived([
    ...makeTargetedPublicationOriginalRelayHintPlans(authorizedTargetingEvents),
    ...makeLegacyTargetedPublicationOriginalRelayHintPlans(authorizedLegacyTargetingEvents),
  ])
  const directEventFilterPlan = $derived.by(() => {
    const relayFilters: Filter[] = []
    const localFilters: Filter[] = []
    if (!communityAuthorityReady || !communityId || !eventParam) {
      return {relayFilters, localFilters}
    }

    for (const target of COMMUNITY_CALENDAR_WRITE_TARGETS) {
      const structuralFilters: Filter[] = [
        {kinds: [target.kind], "#d": [eventParam], "#h": [communityId]},
      ]
      if (isEventIdParam) {
        structuralFilters.unshift({
          kinds: [target.kind],
          ids: [eventParam],
          "#h": [communityId],
        })
      }
      const plan = makeCommunityContentFilterPlan(structuralFilters, calendarWriterPubkeys)
      relayFilters.push(...plan.relayFilters)
      localFilters.push(...plan.localFilters)
    }

    return {relayFilters, localFilters}
  })
  const eventFilterPlan = $derived({
    relayFilters: [
      ...directEventFilterPlan.relayFilters,
      ...targetedEventFilterPlan.relayFilters,
    ] as Filter[],
    localFilters: [
      ...directEventFilterPlan.localFilters,
      ...targetedEventFilterPlan.localFilters,
    ] as Filter[],
  })
  const eventFilters = $derived(eventFilterPlan.localFilters)
  const eventRelayFilters = $derived(eventFilterPlan.relayFilters)
  const eventEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: eventFilters})),
  )
  const eventProjection = $derived.by(() =>
    projectAuthoredPublicationEvents({
      events: $eventEvents,
      operations: $publicationOperations.values(),
      ownerPubkey: $pubkey || "",
      matches: event =>
        isCalendarEventKind(event.kind) &&
        (event.id === eventParam || getTagValue("d", event.tags) === eventParam) &&
        matchFilters(eventFilters, event),
      matchesOperation: (event, operation) =>
        isCalendarEventKind(event.kind) &&
        (event.id === eventParam || getTagValue("d", event.tags) === eventParam) &&
        operation.semanticKey ===
          makeCommunityTargetedPublicationSemanticKey(communityAddress, event.kind),
    }),
  )
  const event = $derived.by(() => {
    const events = sortBy(candidate => -candidate.created_at, eventProjection.events)

    return (
      events.find(candidate => candidate.id === eventParam) ||
      events.find(candidate => getTagValue("d", candidate.tags) === eventParam)
    )
  })
  const eventOperationId = $derived(event ? eventProjection.operationIds.get(event.id) : undefined)
  const eventAddress = $derived.by(() => {
    const identifier = event ? getTagValue("d", event.tags) : ""

    return event && identifier ? `${event.kind}:${event.pubkey}:${identifier}` : ""
  })
  const approvedEvent = $derived(communityAuthorityReady ? event : undefined)
  const approvedEventSectionName = $derived(
    approvedEvent ? getCalendarEventSectionName(approvedEvent.kind) : calendarSectionName,
  )
  const approvedEventCensorReason = $derived.by(() =>
    approvedEvent
      ? getCommunityCensorReason({
          reportState: $activeCommunityReportState,
          eventId: approvedEvent.id,
          eventAddress: getCommunityReportEventAddress(approvedEvent),
          pubkey: approvedEvent.pubkey,
          sectionName: approvedEventSectionName,
        })
      : undefined,
  )
  const replyFilterPlan = $derived(
    communityAuthorityReady && approvedEvent && !approvedEventCensorReason
      ? makeCommunityContentFilterPlan(
          [
            {
              kinds: [COMMENT],
              "#E": [approvedEvent.id],
              "#K": [String(approvedEvent.kind)],
              "#h": [communityId],
            },
            ...(eventAddress
              ? [
                  {
                    kinds: [COMMENT],
                    "#A": [eventAddress],
                    "#K": [String(approvedEvent.kind)],
                    "#h": [communityId],
                  },
                  {
                    kinds: [COMMENT],
                    "#a": [eventAddress],
                    "#K": [String(approvedEvent.kind)],
                    "#h": [communityId],
                  },
                ]
              : []),
          ],
          commentAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const replyFilters = $derived(replyFilterPlan.localFilters)
  const replyRelayFilters = $derived(replyFilterPlan.relayFilters)
  const replyEventsStore = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: replyFilters})),
  )
  const replyProjection = $derived.by(() =>
    projectAuthoredPublicationEvents({
      events: $replyEventsStore,
      operations: $publicationOperations.values(),
      ownerPubkey: $pubkey || "",
      matches: event =>
        matchFilters(replyFilters, event) &&
        Boolean(
          readCommunityCalendarEventReply(event, communityId, approvedEvent?.id, eventAddress),
        ),
    }),
  )
  const replies = $derived(
    sortBy(
      reply => reply.event.created_at,
      filterVisibleAfterDeletesAndEdits(replyProjection.events, $editedTargetIds)
        .map(replyEvent =>
          readCommunityCalendarEventReply(replyEvent, communityId, approvedEvent?.id, eventAddress),
        )
        .filter((reply): reply is NonNullable<ReturnType<typeof readCommunityCalendarEventReply>> =>
          Boolean(reply),
        )
        .filter(
          reply => !isCommunityPersonBanned($activeCommunityReportState, reply!.event.pubkey),
        ),
    ),
  )

  let showAllReplies = $state(false)
  let hashTargetRequest = 0
  let hashTarget = $state({id: "", request: 0})
  let revealedHashTargetKey = ""

  const visibleReplies = $derived(
    showAllReplies ? replies : replies.slice(Math.max(replies.length - 4, 0)),
  )
  const repliesById = $derived.by(() => new Map(replies.map(reply => [reply!.id, reply!])))
  const latestReplyId = $derived(replies.at(-1)?.id || "")

  const canReply = $derived(
    Boolean(
      approvedEvent &&
      !eventOperationId &&
      communityAuthorityReady &&
      !approvedEventCensorReason &&
      $pubkey &&
      $activeExactCommunityRelays.length > 0 &&
      communityDefinition &&
      canWriteCommunityTarget({
        definition: communityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.comment,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const canReact = $derived(
    Boolean(
      approvedEvent &&
      !eventOperationId &&
      communityAuthorityReady &&
      !approvedEventCensorReason &&
      $pubkey &&
      communityDefinition &&
      canWriteCommunityTarget({
        definition: communityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.reaction,
        reportState: $activeCommunityReportState,
      }),
    ),
  )

  const openCommentPrompt = async (replyParent?: TrustedEvent) => {
    parent = replyParent
    eventToEdit = undefined
    showReply = true
    await tick()
    composeElement?.scrollIntoView({behavior: "smooth", block: "end"})
    compose?.focus()
  }

  const openEditPrompt = async (event: TrustedEvent) => {
    parent = undefined
    eventToEdit = event
    showReply = true
    await tick()
    composeElement?.scrollIntoView({behavior: "smooth", block: "end"})
    compose?.focus()
  }

  const closeCommentPrompt = () => {
    parent = undefined
    eventToEdit = undefined
    showReply = false
  }

  const clearParent = () => {
    parent = undefined
  }

  const sendReply = async ({content, tags}: EventContent) => {
    const trimmed = content.trim()
    if (!approvedEvent || !trimmed) return false
    if (!canReply) {
      pushToast({theme: "error", message: commentAccessMessage})
      return false
    }
    const relays = $activeExactCommunityPublishRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return false
    }

    if (eventToEdit) {
      try {
        await publishEditedReply({
          event: eventToEdit,
          content: trimmed,
          tags,
          relays,
          url: communityId,
        })
      } catch (error) {
        pushToast({
          theme: "error",
          message: error instanceof Error ? error.message : "Failed to publish edit.",
        })
        return false
      }
      closeCommentPrompt()
      return true
    }

    const template = makeCommunityCalendarEventReply({
      communityPubkey: communityId,
      calendarEvent: approvedEvent,
      relay: relays[0],
      content: trimmed,
      tags,
      parent: parent
        ? {id: parent.id, pubkey: parent.pubkey, kind: parent.kind, relay: relays[0]}
        : undefined,
    })

    try {
      startPublication({
        relays,
        event: makeEvent(COMMENT, template),
        label: "Calendar comment",
        href: eventPath,
        preview: "retain-on-failure",
      })
    } catch (error) {
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Failed to publish comment.",
      })
      return false
    }

    closeCommentPrompt()
    return true
  }

  const scrollToReplyParent = async (event: TrustedEvent) => {
    showAllReplies = true
    await tick()
    await scrollToEvent(event.id)
  }

  const openReply = () => openCommentPrompt()
  const canEditReply = (event: TrustedEvent) => canEditReplyEvent(event, $pubkey, canReply)

  let loadingEvent = $state(false)
  let eventLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingTargeting = $state(false)
  let targetLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingHintedOriginals = $state(false)
  let hintedOriginalLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingReplies = $state(false)
  let historicalLoadRetryVersion = $state(0)
  let showReply = $state(false)
  let parent: TrustedEvent | undefined = $state()
  let eventToEdit: TrustedEvent | undefined = $state()
  let compose: RoomCompose | undefined = $state()
  let composeElement: HTMLElement | undefined = $state()

  const syncHashTarget = () => {
    const match = window.location.hash.match(/^#event-([0-9a-f]{64})$/i)
    hashTarget = {id: match?.[1]?.toLowerCase() || "", request: ++hashTargetRequest}
  }

  $effect(() => {
    if (typeof window === "undefined") return

    syncHashTarget()
    window.addEventListener("hashchange", syncHashTarget)

    return () => window.removeEventListener("hashchange", syncHashTarget)
  })

  $effect(() => {
    void historicalLoadRetryVersion
    const relays = $activeExactCommunityRelays

    if (!communityBootstrapReady) {
      loadingEvent = false
      eventLoadStatus = "idle"
      return
    }
    if (eventRelayFilters.length === 0 || eventFilters.length === 0) {
      loadingEvent = false
      eventLoadStatus = "complete"
      return
    }
    if (relays.length === 0) {
      loadingEvent = false
      eventLoadStatus = "incomplete"
      return
    }

    const controller = new AbortController()

    loadingEvent = true
    eventLoadStatus = "loading"
    void loadBoundedCommunityHistory({
      relays,
      relayFilters: eventRelayFilters,
      localFilters: eventFilters,
      timeoutMs: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-calendar-event:${communityAddress}:${eventParam}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        eventLoadStatus = result.complete ? "complete" : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-calendar-event] Failed to load event history", error)
        eventLoadStatus = "failed"
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingEvent = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    void historicalLoadRetryVersion
    const plans = targetedEventRelayHintPlans

    if (!communityBootstrapReady) {
      loadingHintedOriginals = false
      hintedOriginalLoadStatus = "idle"
      return
    }
    if (plans.length === 0) {
      loadingHintedOriginals = false
      hintedOriginalLoadStatus = "complete"
      return
    }

    const controller = new AbortController()
    loadingHintedOriginals = true
    hintedOriginalLoadStatus = "loading"
    void Promise.all(
      plans.map(plan =>
        loadBoundedCommunityHistory({
          ...plan,
          timeoutMs: REQUEST_HARD_TIMEOUT_MS,
          priority: RELAY_REQUEST_PRIORITY.interactive,
          owner: `community-calendar-event-originals:${communityAddress}:${eventParam}`,
          signal: controller.signal,
        }),
      ),
    )
      .then(results => {
        if (controller.signal.aborted) return
        hintedOriginalLoadStatus = results.every(result => result.complete)
          ? "complete"
          : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-calendar-event] Failed to load hinted event originals", error)
        hintedOriginalLoadStatus = "failed"
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingHintedOriginals = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    void historicalLoadRetryVersion

    const relays = $activeExactCommunityRelays
    const relayFilters = targetingFilterPlan.relayFilters
    const localFilters = targetingFilterPlan.localFilters

    if (!communityBootstrapReady) {
      loadingTargeting = false
      targetLoadStatus = "idle"
      return
    }
    if (relayFilters.length === 0 || localFilters.length === 0) {
      loadingTargeting = false
      targetLoadStatus = "complete"
      return
    }
    if (relays.length === 0) {
      loadingTargeting = false
      targetLoadStatus = "incomplete"
      return
    }

    const controller = new AbortController()

    loadingTargeting = true
    targetLoadStatus = "loading"
    void loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters,
      timeoutMs: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-calendar-event-targets:${communityAddress}:${eventParam}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        targetLoadStatus = result.complete ? "complete" : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-calendar-event] Failed to load targeting history", error)
        targetLoadStatus = "failed"
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingTargeting = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    void historicalLoadRetryVersion

    const relays = $activeExactCommunityRelays

    if (!communityBootstrapReady) {
      loadingReplies = false
      return
    }
    if (replyRelayFilters.length === 0 || replyFilters.length === 0) {
      loadingReplies = false
      return
    }
    if (relays.length === 0) {
      loadingReplies = false
      return
    }

    const controller = new AbortController()

    loadingReplies = true
    void loadBoundedCommunityHistory({
      relays,
      relayFilters: replyRelayFilters,
      localFilters: replyFilters,
      timeoutMs: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-calendar-replies:${communityAddress}:${eventParam}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-calendar-event] Failed to load reply history", error)
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingReplies = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    if (event) {
      loadingEvent = false
    }
    if (replies.length > 0) {
      loadingReplies = false
    }
  })

  $effect(() => {
    const {id, request} = hashTarget
    const targetKey = `${eventPath}:${request}:${id}`
    const targetIsLoaded = approvedEvent?.id === id || replies.some(reply => reply.id === id)
    if (!id || !targetIsLoaded || revealedHashTargetKey === targetKey) return

    revealedHashTargetKey = targetKey
    showAllReplies = true
    void tick().then(() => {
      if (hashTarget.request === request) void scrollToEvent(id)
    })
  })

  const retryHistoricalLoad = () => {
    if (communityBootstrapFailed || communityAuthorityUnavailable) {
      window.location.reload()
      return
    }

    historicalLoadRetryVersion += 1
  }

  onDestroy(() => {
    setChecked(eventPath)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div>
      <a href={calendarPath || "#"} class="btn btn-neutral btn-sm">
        <Icon icon={AltArrowLeft} />
      </a>
    </div>
  {/snippet}
  {#snippet title()}
    <strong
      >{approvedEventCensorReason
        ? "Moderated event"
        : approvedEvent
          ? getTagValue("title", approvedEvent.tags) ||
            getTagValue("name", approvedEvent.tags) ||
            "Calendar event"
          : "Calendar event"}</strong>
  {/snippet}
  {#snippet action()}
    <CommunityMenuButton community={routeCommunity?.naddr} />
  {/snippet}
</PageBar>

<PageContent class="flex flex-col gap-3 p-2 pt-4">
  {#if approvedEvent}
    <article class="card2 bg-alt col-3 z-feature" data-event={approvedEvent.id}>
      {#if approvedEventCensorReason}
        <ModeratedContent reason={approvedEventCensorReason} />
      {:else}
        <div class="flex items-start gap-4">
          <CalendarEventDate event={approvedEvent} />
          <div class="flex min-w-0 flex-grow flex-col gap-1">
            <CalendarEventHeader event={approvedEvent} />
            <CalendarEventMeta event={approvedEvent} relays={$activeExactCommunityRelays} />
            <CalendarEventDescription
              event={approvedEvent}
              url={communityId}
              relays={$activeExactCommunityRelays}
              communitySectionName={approvedEventSectionName} />
            {#if eventOperationId}
              <PublicationStatus operationId={eventOperationId} />
            {/if}
          </div>
        </div>
        {#if !eventOperationId}
          <div class="flex w-full flex-col justify-end sm:flex-row">
            <CalendarEventActions
              url={communityId}
              community={routeCommunity}
              relays={$activeExactCommunityRelays}
              publishRelays={$activeExactCommunityPublishRelays}
              reactionRelays={$activeExactCommunityPublishRelays}
              scopeH={communityId}
              communitySectionName={approvedEventSectionName}
              allowedAuthors={commentAuthorPubkeys}
              reactionAllowedAuthors={reactionAuthorPubkeys}
              reportAllowedAuthors={reportAuthorPubkeys}
              readOnly={!canReact}
              redirectOnEdit
              event={approvedEvent} />
          </div>
        {/if}
      {/if}
    </article>

    {#if !approvedEventCensorReason && !showAllReplies && replies.length > visibleReplies.length}
      <div class="flex justify-center py-2">
        <button class="btn btn-link" type="button" onclick={() => (showAllReplies = true)}>
          Show all {replies.length} comments
        </button>
      </div>
    {/if}

    {#if !approvedEventCensorReason}
      <div class="col-2">
        {#each visibleReplies as item (item.id)}
          {@const replyParent = item.parentReplyId
            ? repliesById.get(item.parentReplyId)?.event
            : undefined}
          <div
            class="card2 bg-alt z-feature w-full shadow-sm"
            data-latest-reply={item.id === latestReplyId ? "true" : undefined}>
            <ChannelMessage
              url={communityId}
              community={routeCommunity}
              event={item.event}
              operationId={replyProjection.operationIds.get(item.id)}
              showPubkey
              readOnly={!canReact}
              interactionRelays={$activeExactCommunityRelays}
              actionRelays={$activeExactCommunityPublishRelays}
              profileRelays={$activeExactCommunityRelays}
              allowedAuthors={commentAuthorPubkeys}
              reactionAllowedAuthors={reactionAuthorPubkeys}
              reportAllowedAuthors={reportAuthorPubkeys}
              scopeH={communityId}
              communitySectionName={commentSectionName}
              {replyParent}
              onReplyParentOpen={scrollToReplyParent}
              canEdit={canEditReply}
              onEdit={openEditPrompt}
              replyTo={canReply ? event => openCommentPrompt(event) : undefined} />
          </div>
        {:else}
          {#if loadingReplies}
            <p class="flex h-10 items-center justify-center py-20 text-center">
              <Spinner loading>Looking for comments...</Spinner>
            </p>
          {:else if communityAuthorityLoading}
            <p class="flex h-10 items-center justify-center py-20 text-center">
              <Spinner loading>Loading comments...</Spinner>
            </p>
          {:else}
            <p class="py-8 text-center opacity-70">No comments yet.</p>
          {/if}
        {/each}
      </div>
    {/if}

    {#if !approvedEventCensorReason && showReply}
      <div bind:this={composeElement} class="card2 bg-alt col-3 p-4 shadow-md">
        <div class="flex items-center justify-between gap-2">
          <strong>{parent ? "Reply" : "Comment"}</strong>
          <button class="btn btn-link btn-sm" type="button" onclick={closeCommentPrompt}>
            Cancel
          </button>
        </div>
        {#if parent}
          <RoomComposeParent event={parent} clear={clearParent} verb="Replying to" />
        {/if}
        {#if eventToEdit}
          <RoomComposeEdit clear={() => (eventToEdit = undefined)} />
        {/if}
        {#key eventToEdit}
          <RoomCompose
            url={$activeExactCommunityRelays[0] || communityId}
            h={communityId}
            blossomContext={communityDefinition
              ? {
                  type: "community",
                  communityAddress: communityDefinition.pointer.address,
                }
              : undefined}
            showMenu={false}
            onSubmit={sendReply}
            onEscape={closeCommentPrompt}
            content={eventToEdit?.content}
            bind:this={compose} />
        {/key}
      </div>
    {:else if !approvedEventCensorReason}
      <div class="flex justify-end px-2 pb-2">
        {#if canReply}
          <button class="btn btn-primary" type="button" onclick={openReply}>
            <Icon icon={Reply} />
            Comment
          </button>
        {:else if communityBootstrapLoading || communityAuthorityLoading}
          <div class="flex items-center gap-2 text-sm opacity-70">
            <Spinner loading>Checking comment access...</Spinner>
          </div>
        {:else}
          <PublishGate
            target={COMMUNITY_WRITE_TARGETS.comment}
            action="comment on events"
            class="btn btn-primary">
            <Icon icon={Reply} />
            Comment
          </PublishGate>
        {/if}
      </div>
    {/if}
  {:else if communityBootstrapLoading || communityAuthorityLoading || loadingEvent || loadingTargeting || loadingHintedOriginals || eventLoadStatus === "queued" || eventLoadStatus === "loading" || (communityBootstrapReady && targetLoadStatus === "idle") || targetLoadStatus === "queued" || targetLoadStatus === "loading" || hintedOriginalLoadStatus === "loading" || (!event && eventFilters.length > 0 && eventLoadStatus === "idle")}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading event...</Spinner>
    </p>
  {:else if communityBootstrapFailed || communityAuthorityUnavailable}
    <div class="flex flex-col items-center gap-3 py-8 text-center opacity-70">
      <p>Event unavailable.</p>
      <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
        >Retry</button>
    </div>
  {:else}
    <p class="py-8 text-center opacity-70">Event not found or not approved for this community.</p>
  {/if}
</PageContent>
