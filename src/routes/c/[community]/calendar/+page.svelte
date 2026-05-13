<script lang="ts">
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {EVENT_TIME, makeEvent, getTagValue} from "@welshman/util"
  import {HOUR, randomId} from "@welshman/lib"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Field from "@lib/components/Field.svelte"
  import DateTimeInput from "@lib/components/DateTimeInput.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {TARGETED_PUBLICATION_KIND} from "@app/core/community"
  import {makeCommunityTargetingFilter, makeTargetedPublicationOriginalFilters} from "@app/core/community-feeds"
  import {
    makeAddressablePublicationRef,
    makeTargetedPublicationForCommunity,
    withPublicationTargetingId,
  } from "@app/core/community-targeting"
  import {COMMUNITY_WRITE_TARGETS, canWriteCommunityTarget} from "@app/core/community-permissions"
  import {parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const targetingFilters = $derived(
    communityPubkey ? [makeCommunityTargetingFilter(communityPubkey, [EVENT_TIME])] : [],
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
  const eventFilters = $derived(makeTargetedPublicationOriginalFilters($targetingEvents))
  const calendarEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: eventFilters})))
  const canCreateEvent = $derived(
    Boolean(
      $pubkey &&
        $activeCommunityDefinition &&
        canWriteCommunityTarget({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          userPubkey: $pubkey,
          target: COMMUNITY_WRITE_TARGETS.calendar,
        }),
    ),
  )

  const createEvent = () => {
    if (!$pubkey || !communityPubkey || !title.trim()) return
    if (!canCreateEvent) {
      pushToast({theme: "error", message: "You do not have permission to publish calendar events."})
      return
    }
    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    const eventId = randomId()
    const targetingId = randomId()
    const eventTemplate = withPublicationTargetingId(
      {
        content: description.trim(),
        tags: [
          ["d", eventId],
          ["title", title.trim()],
          ["start", String(start)],
          ["end", String(end)],
        ],
      },
      targetingId,
    )
    const originalRef = makeAddressablePublicationRef({
      kind: EVENT_TIME,
      pubkey: $pubkey,
      identifier: eventId,
      relay: relays[0],
    })

    publishThunk({relays, event: makeEvent(EVENT_TIME, eventTemplate)})
    publishThunk({
      relays,
      event: makeEvent(
        TARGETED_PUBLICATION_KIND,
        makeTargetedPublicationForCommunity({
          targetingId,
          originalKind: EVENT_TIME,
          originalRef,
          communityPubkey,
          communityRelay: relays[0],
        }),
      ),
    })

    title = ""
    description = ""
    pushToast({message: "Calendar event published."})
  }

  let title = $state("")
  let description = $state("")
  const initialStart = Math.floor(Date.now() / 1000) + HOUR
  let start = $state(initialStart)
  let end = $state(initialStart + HOUR)

  $effect(() => {
    if (!communityPubkey || $activeCommunityRelays.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters: targetingFilters, signal: controller.signal})

    return () => controller.abort()
  })

  $effect(() => {
    if ($activeCommunityRelays.length === 0 || eventFilters.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters: eventFilters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={CalendarMinimalistic} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Calendar</strong>
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createEvent)}>
    <strong>Create targeted calendar event</strong>
    <Field>
      {#snippet label()}
        <p>Title</p>
      {/snippet}
      {#snippet input()}
        <input bind:value={title} class="input input-bordered w-full" type="text" />
      {/snippet}
    </Field>
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
    <Field>
      {#snippet label()}
        <p>Description</p>
      {/snippet}
      {#snippet input()}
        <textarea bind:value={description} class="textarea textarea-bordered" rows="4"></textarea>
      {/snippet}
    </Field>
    <div class="flex justify-end">
      <PublishGate target={COMMUNITY_WRITE_TARGETS.calendar} action="publish calendar events" submit disabled={!title.trim()}>
        Create event
      </PublishGate>
    </div>
  </form>

  <div class="col-2">
    {#each $calendarEvents as event (event.id)}
      <div class="card2 bg-alt p-4 shadow-md">
        <strong>{getTagValue("title", event.tags) || "Untitled event"}</strong>
        <p class="text-sm opacity-70">{new Date(Number(getTagValue("start", event.tags) || 0) * 1000).toLocaleString()}</p>
        {#if event.content}
          <p class="whitespace-pre-wrap">{event.content}</p>
        {/if}
      </div>
    {:else}
      <p class="py-8 text-center opacity-70">No targeted calendar events found.</p>
    {/each}
  </div>
</PageContent>
