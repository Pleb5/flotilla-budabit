<script lang="ts">
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {pubkey} from "@welshman/app"
  import {HOUR, now, randomId} from "@welshman/lib"
  import {EVENT_DATE, EVENT_TIME, makeEvent} from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import CalendarAdd from "@assets/icons/calendar-add.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Field from "@lib/components/Field.svelte"
  import DateTimeInput from "@lib/components/DateTimeInput.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    makeCalendarEventTags,
    parseCalendarDate,
    timestampToDateInputValue,
    type CalendarEventKind,
  } from "@app/core/calendar-events"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDescriptor,
    activeExactCommunityDefinition,
    activeCommunityProfileListEvents,
    activeExactCommunityPublishRelays,
    activeCommunityReportState,
  } from "@app/core/community-state"
  import {TARGETED_PUBLICATION_KIND, normalizeRelays} from "@app/core/community"
  import {
    makeAddressablePublicationRef,
    makeCommunityTargetedPublicationSemanticKey,
    makeTargetedPublicationForCommunity,
    withPublicationTargetingId,
  } from "@app/core/community-targeting"
  import {
    COMMUNITY_CALENDAR_WRITE_TARGETS,
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityCalendarTarget,
    getCommunityCalendarWriteTargetSectionName,
  } from "@app/core/community-permissions"
  import {startLinkedPublication} from "@app/core/publication-operations"
  import {makeExactCommunityCalendarPath, parseExactCommunityRouteParam} from "@app/util/routes"

  const routeCommunity = $derived(parseExactCommunityRouteParam($page.params.community))
  const communityOwnerPubkey = $derived(routeCommunity?.ownerPubkey || "")
  const communityId = $derived(routeCommunity?.communityId || "")
  const communityAddress = $derived(routeCommunity?.address || "")
  const communityDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityAddress
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const calendarPath = $derived(
    routeCommunity ? makeExactCommunityCalendarPath(routeCommunity) : "",
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityAddress &&
      communityDefinition &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityAuthorityReadiness = $derived(
    $activeCommunityDescriptor?.community.address === communityAddress
      ? $activeCommunityDescriptor.authorityReadiness.state
      : "loading",
  )
  const communityReady = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "ready",
  )
  const initialStart = Math.floor(Date.now() / 1000) + HOUR

  let title = $state("")
  let location = $state("")
  let description = $state("")
  let eventKind = $state<CalendarEventKind>(EVENT_TIME)
  let start = $state(initialStart)
  let end = $state(initialStart + HOUR)
  let startDate = $state(timestampToDateInputValue(initialStart))
  let endDate = $state(timestampToDateInputValue(initialStart))
  let publishing = $state(false)

  const isDateBased = $derived(eventKind === EVENT_DATE)
  const calendarSectionName = $derived(
    getCommunityCalendarWriteTargetSectionName(communityReady ? communityDefinition : undefined),
  )
  const calendarAccessMessage = $derived(
    `Request ${calendarSectionName} access to publish calendar events.`,
  )
  const canCreateEvent = $derived(
    Boolean(
      $pubkey &&
      communityReady &&
      communityDefinition &&
      canWriteCommunityCalendarTarget({
        definition: communityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        reportState: $activeCommunityReportState,
      }),
    ),
  )

  const validateDateRange = () => {
    const normalizedStartDate = parseCalendarDate(startDate)
    const normalizedEndDate = parseCalendarDate(endDate) || normalizedStartDate

    if (!normalizedStartDate) {
      pushToast({theme: "error", message: "Please provide a valid start date."})
      return undefined
    }

    if (!normalizedEndDate) {
      pushToast({theme: "error", message: "Please provide a valid end date."})
      return undefined
    }

    if (normalizedEndDate < normalizedStartDate) {
      pushToast({theme: "error", message: "End date must be on or after start date."})
      return undefined
    }

    if (normalizedEndDate < timestampToDateInputValue(now())) {
      pushToast({theme: "error", message: "End date must be today or later."})
      return undefined
    }

    return {startDate: normalizedStartDate, endDate: normalizedEndDate}
  }

  const validateTimeRange = () => {
    if (!start || !end) {
      pushToast({theme: "error", message: "Please provide start and end times."})
      return undefined
    }

    if (start >= end) {
      pushToast({theme: "error", message: "End time must be later than start time."})
      return undefined
    }

    if (end <= now()) {
      pushToast({theme: "error", message: "End time must be in the future."})
      return undefined
    }

    return {start, end}
  }

  const createEvent = async () => {
    const trimmedTitle = title.trim()
    if (publishing || !$pubkey || !routeCommunity || !communityId || !trimmedTitle) return

    const currentEventKind = eventKind
    if (!communityReady) {
      pushToast({
        theme: "error",
        message:
          communityAuthorityReadiness === "unavailable"
            ? "Calendar unavailable."
            : "Calendar is still loading.",
      })
      return
    }
    if (!canCreateEvent) {
      pushToast({theme: "error", message: calendarAccessMessage})
      return
    }

    const dateRange = currentEventKind === EVENT_DATE ? validateDateRange() : undefined
    const timeRange = currentEventKind === EVENT_TIME ? validateTimeRange() : undefined
    if (currentEventKind === EVENT_DATE && !dateRange) return
    if (currentEventKind === EVENT_TIME && !timeRange) return

    const relays = normalizeRelays($activeExactCommunityPublishRelays)
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    const authorPubkey = $pubkey
    const eventId = randomId()
    const targetingId = randomId()
    const community = routeCommunity
    const eventTemplate = withPublicationTargetingId(
      {
        content: description.trim(),
        tags: makeCalendarEventTags({
          kind: currentEventKind,
          identifier: eventId,
          title: trimmedTitle,
          location: location.trim(),
          start: timeRange?.start,
          end: timeRange?.end,
          startDate: dateRange?.startDate,
          endDate: dateRange?.endDate,
        }),
      },
      targetingId,
    )

    publishing = true

    try {
      startLinkedPublication({
        event: makeEvent(currentEventKind, eventTemplate),
        relays,
        targetEvent: originalAckRelay => {
          const originalRef = makeAddressablePublicationRef({
            kind: currentEventKind,
            pubkey: authorPubkey,
            identifier: eventId,
            relay: originalAckRelay,
          })

          return makeEvent(
            TARGETED_PUBLICATION_KIND,
            makeTargetedPublicationForCommunity({
              targetingId,
              originalKind: currentEventKind,
              originalRef,
              community,
            }),
          )
        },
        label: "Community calendar event",
        href: calendarPath,
        semanticKey: makeCommunityTargetedPublicationSemanticKey(
          communityAddress,
          currentEventKind,
        ),
        preview: "retain-on-failure",
      })
    } catch (error) {
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Failed to start event publication.",
      })
      return
    } finally {
      publishing = false
    }

    pushToast({message: "Calendar event publication started."})
    if (calendarPath) await goto(calendarPath)
  }
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
    <strong>Create an Event</strong>
  {/snippet}
  {#snippet action()}
    <CommunityMenuButton community={routeCommunity?.naddr} />
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createEvent)}>
    <strong>Create calendar event</strong>
    <Field>
      {#snippet label()}
        <p>Title</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={CalendarAdd} />
          <input bind:value={title} class="grow" type="text" />
        </label>
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        <p>Event type</p>
      {/snippet}
      {#snippet input()}
        <select bind:value={eventKind} class="select select-bordered w-full">
          <option value={EVENT_TIME}>Timed event</option>
          <option value={EVENT_DATE}>All-day event</option>
        </select>
      {/snippet}
    </Field>
    {#if isDateBased}
      <Field>
        {#snippet label()}
          <p>Start date</p>
        {/snippet}
        {#snippet input()}
          <input bind:value={startDate} class="input input-bordered w-full" type="date" />
        {/snippet}
      </Field>
      <Field>
        {#snippet label()}
          <p>End date <span class="text-xs opacity-70">inclusive</span></p>
        {/snippet}
        {#snippet input()}
          <input bind:value={endDate} class="input input-bordered w-full" type="date" />
        {/snippet}
      </Field>
    {:else}
      <Field>
        {#snippet label()}
          <p>Start</p>
        {/snippet}
        {#snippet input()}
          <DateTimeInput bind:value={start} />
        {/snippet}
      </Field>
      <Field>
        {#snippet label()}
          <p>End</p>
        {/snippet}
        {#snippet input()}
          <DateTimeInput bind:value={end} />
        {/snippet}
      </Field>
    {/if}
    <Field>
      {#snippet label()}
        <p>Location</p>
      {/snippet}
      {#snippet input()}
        <input bind:value={location} class="input input-bordered w-full" type="text" />
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        <p>Description</p>
      {/snippet}
      {#snippet input()}
        <textarea bind:value={description} class="textarea textarea-bordered" rows="6"></textarea>
      {/snippet}
    </Field>
    <div class="flex justify-end">
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.calendar}
        alternateTargets={COMMUNITY_CALENDAR_WRITE_TARGETS}
        action="publish calendar events"
        submit
        disabled={publishing || !title.trim()}>
        {publishing ? "Publishing..." : "Create event"}
      </PublishGate>
    </div>
  </form>
</PageContent>
