<script lang="ts">
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import RoomName from "@app/components/RoomName.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActivity from "@app/components/EventActivity.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import CalendarEventEdit from "@app/components/CalendarEventEdit.svelte"
  import {
    makeCalendarEventFilename,
    makeCalendarEventIcs,
    makeGoogleCalendarEventUrl,
  } from "@app/core/calendar-export"
  import {publishReactionDeleteOperation, publishReactionOperation} from "@app/core/commands"
  import {makeExactCommunityCalendarPath} from "@app/util/routes"
  import type {CommunityPointer} from "@app/core/community"
  import {pushModal} from "@app/util/modal"
  import {downloadText} from "@lib/html"
  import CalendarAdd from "@assets/icons/calendar-add.svg?dataurl"
  import FileDownload from "@assets/icons/file-download.svg?dataurl"
  import Pen2 from "@assets/icons/pen-2.svg?dataurl"

  type Props = {
    url: string
    community?: CommunityPointer
    event: TrustedEvent
    showRoom?: boolean
    showActivity?: boolean
    relays?: string[]
    publishRelays?: string[]
    reactionRelays?: string[]
    scopeH?: string
    communitySectionName?: string
    readOnly?: boolean
    allowedAuthors?: string[]
    reactionAllowedAuthors?: string[]
    reportAllowedAuthors?: string[]
    redirectOnEdit?: boolean
    activityLiveCovered?: boolean
  }

  const {
    url,
    community = undefined,
    event,
    showRoom,
    showActivity,
    relays = [],
    publishRelays = undefined,
    reactionRelays = undefined,
    scopeH = "",
    communitySectionName = "",
    readOnly = false,
    allowedAuthors = undefined,
    reactionAllowedAuthors = undefined,
    reportAllowedAuthors = undefined,
    redirectOnEdit = false,
    activityLiveCovered = false,
  }: Props = $props()

  const h = getTagValue("h", event.tags)
  const eventRouteParam = event.id || getTagValue("d", event.tags)
  const path = community ? makeExactCommunityCalendarPath(community, eventRouteParam) : ""
  const canExport = $derived(Boolean(makeCalendarEventIcs(event)))
  const actionRelays = $derived(
    publishRelays ?? (relays.length > 0 ? relays : !scopeH && url ? [url] : []),
  )
  const reactionRelayTargets = $derived(reactionRelays ?? actionRelays)

  const getEventPageUrl = () => new URL(path, window.location.origin).toString()

  const addToGoogleCalendar = () => {
    const calendarUrl = makeGoogleCalendarEventUrl(event, {url: getEventPageUrl()})

    if (calendarUrl) window.open(calendarUrl, "_blank", "noopener")
  }

  const downloadCalendarEvent = () => {
    const calendar = makeCalendarEventIcs(event, {url: getEventPageUrl()})

    if (calendar) {
      downloadText(makeCalendarEventFilename(event), calendar, "text/calendar;charset=utf-8")
    }
  }

  const editEvent = () =>
    pushModal(CalendarEventEdit, {
      url,
      event,
      relays: actionRelays,
      redirectPath: redirectOnEdit ? path : undefined,
    })

  const deleteReaction = async (reaction: TrustedEvent) =>
    publishReactionDeleteOperation({reaction, targetEvent: event, relays: reactionRelayTargets})

  const createReaction = async (template: EventContent) =>
    publishReactionOperation({
      ...template,
      event,
      relays: reactionRelayTargets,
      tags: template.tags || [],
    })
</script>

<div class="flex flex-grow flex-wrap items-center justify-end gap-2">
  {#if h && showRoom}
    <span class="btn btn-neutral btn-xs rounded-full">Posted in #<RoomName {h} {url} /></span>
  {/if}
  <EventActions
    {url}
    relays={actionRelays}
    reactionRelays={reactionRelayTargets}
    {scopeH}
    {communitySectionName}
    {readOnly}
    {event}
    noun="Event"
    allowAdminDelete={false}>
    {#snippet customActions()}
      {#if canExport}
        <li>
          <Button onclick={addToGoogleCalendar}>
            <Icon size={4} icon={CalendarAdd} />
            Add to Google Calendar
          </Button>
        </li>
        <li>
          <Button onclick={downloadCalendarEvent}>
            <Icon size={4} icon={FileDownload} />
            Download calendar file
          </Button>
        </li>
      {/if}
      {#if event.pubkey === $pubkey}
        <li>
          <Button onclick={editEvent}>
            <Icon size={4} icon={Pen2} />
            Edit Event
          </Button>
        </li>
      {/if}
    {/snippet}
  </EventActions>
  <ReactionSummary
    {url}
    {relays}
    operationRelays={reactionRelayTargets}
    {scopeH}
    {event}
    {readOnly}
    {allowedAuthors}
    {reactionAllowedAuthors}
    {reportAllowedAuthors}
    {deleteReaction}
    {createReaction}
    reactionClass="tooltip-left" />
  <ThunkStatusOrDeleted {event} />
  {#if showActivity}
    <EventActivity
      {url}
      {path}
      {event}
      {relays}
      {scopeH}
      {allowedAuthors}
      coreCommunityLiveCovered={activityLiveCovered} />
  {/if}
  {#if canExport}
    <div class="join rounded-full" role="group" aria-label="Calendar export actions">
      <Button
        class="btn join-item btn-neutral btn-xs tooltip tooltip-left"
        data-tip="Add to Google Calendar"
        aria-label="Add to Google Calendar"
        onclick={addToGoogleCalendar}>
        <Icon size={4} icon={CalendarAdd} />
      </Button>
      <Button
        class="btn join-item btn-neutral btn-xs tooltip tooltip-left"
        data-tip="Download calendar file"
        aria-label="Download calendar file"
        onclick={downloadCalendarEvent}>
        <Icon size={4} icon={FileDownload} />
      </Button>
    </div>
  {/if}
</div>
