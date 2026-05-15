<script lang="ts">
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Link from "@lib/components/Link.svelte"
  import RoomName from "@app/components/RoomName.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActivity from "@app/components/EventActivity.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import CalendarEventEdit from "@app/components/CalendarEventEdit.svelte"
  import {publishSocialDelete, publishReaction, canEnforceNip70} from "@app/core/commands"
  import {makeCalendarPath, makeSpacePath} from "@app/util/routes"
  import {pushModal} from "@app/util/modal"
  import Pen2 from "@assets/icons/pen-2.svg?dataurl"

  type Props = {
    url: string
    event: TrustedEvent
    showRoom?: boolean
    showActivity?: boolean
    relays?: string[]
    scopeH?: string
    readOnly?: boolean
    allowedAuthors?: string[]
    redirectOnEdit?: boolean
  }

  const {
    url,
    event,
    showRoom,
    showActivity,
    relays = [],
    scopeH = "",
    readOnly = false,
    allowedAuthors = undefined,
    redirectOnEdit = false,
  }: Props = $props()

  const h = getTagValue("h", event.tags)
  const eventRouteParam = getTagValue("d", event.tags) || event.id
  const path = makeCalendarPath(url, eventRouteParam)
  const shouldProtect = canEnforceNip70(url)

  const editEvent = () =>
    pushModal(CalendarEventEdit, {url, event, relays, redirectPath: redirectOnEdit ? path : undefined})

  const deleteReaction = async (event: TrustedEvent) =>
    publishSocialDelete({url, event, protect: await shouldProtect})

  const createReaction = async (template: EventContent) =>
    publishReaction({
      ...template,
      event,
      relays: relays.length ? relays : [url],
      tags: [...(template.tags || []), ...(scopeH ? [["h", scopeH]] : [])],
      protect: await shouldProtect,
    })
</script>

<div class="flex flex-grow flex-wrap items-center justify-end gap-2">
  {#if h && showRoom}
    <Link href={makeSpacePath(url, h)} class="btn btn-neutral btn-xs rounded-full">
      Posted in #<RoomName {h} {url} />
    </Link>
  {/if}
  <ReactionSummary
    {url}
    {relays}
    {scopeH}
    {event}
    {readOnly}
    {allowedAuthors}
    {deleteReaction}
    {createReaction}
    reactionClass="tooltip-left" />
  <ThunkStatusOrDeleted {event} />
  {#if showActivity}
    <EventActivity {url} {path} {event} {relays} {scopeH} {allowedAuthors} />
  {/if}
  <EventActions {url} {relays} {scopeH} {readOnly} {event} noun="Event" showReport={false} allowAdminDelete={false}>
    {#snippet customActions()}
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
</div>
