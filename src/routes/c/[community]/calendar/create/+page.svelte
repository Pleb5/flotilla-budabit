<script lang="ts">
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {pubkey, publishThunk} from "@welshman/app"
  import {HOUR, randomId} from "@welshman/lib"
  import {EVENT_TIME, makeEvent} from "@welshman/util"
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
  import {daysBetween} from "@lib/util"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
    getUserOutboxRelays,
  } from "@app/core/community-state"
  import {TARGETED_PUBLICATION_KIND, normalizeRelays} from "@app/core/community"
  import {
    makeAddressablePublicationRef,
    makeTargetedPublicationForCommunity,
    withPublicationTargetingId,
  } from "@app/core/community-targeting"
  import {COMMUNITY_WRITE_TARGETS, canWriteCommunityTarget} from "@app/core/community-permissions"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const calendarPath = $derived(communityPubkey ? makeCommunityPath(communityPubkey, "calendar") : "")
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
    const trimmedTitle = title.trim()
    if (!$pubkey || !communityPubkey || !trimmedTitle) return
    if (!canCreateEvent) {
      pushToast({theme: "error", message: "You do not have permission to publish calendar events."})
      return
    }
    if (!start || !end) {
      pushToast({theme: "error", message: "Please provide start and end times."})
      return
    }
    if (start >= end) {
      pushToast({theme: "error", message: "End time must be later than start time."})
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
          ["title", trimmedTitle],
          ["location", location.trim()],
          ["start", String(start)],
          ["end", String(end)],
          ...daysBetween(start, end).map(day => ["D", String(day)]),
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
    const originalRelays = normalizeRelays([...getUserOutboxRelays(), ...relays])

    publishThunk({relays: originalRelays.length ? originalRelays : relays, event: makeEvent(EVENT_TIME, eventTemplate)})
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

    pushToast({message: "Calendar event published."})
    if (calendarPath) goto(calendarPath)
  }

  const initialStart = Math.floor(Date.now() / 1000) + HOUR
  let title = $state("")
  let location = $state("")
  let description = $state("")
  let start = $state(initialStart)
  let end = $state(initialStart + HOUR)
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
    <CommunityMenuButton community={communityPubkey} />
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
        action="publish calendar events"
        submit
        disabled={!title.trim()}>
        Create event
      </PublishGate>
    </div>
  </form>
</PageContent>
