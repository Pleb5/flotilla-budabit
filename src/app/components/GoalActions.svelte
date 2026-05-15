<script lang="ts">
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import Link from "@lib/components/Link.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActivity from "@app/components/EventActivity.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import RoomName from "@app/components/RoomName.svelte"
  import {publishDelete, publishReaction, canEnforceNip70} from "@app/core/commands"
  import {makeGoalPath, makeSpacePath} from "@app/util/routes"

  interface Props {
    url: string
    event: TrustedEvent
    showRoom?: boolean
    showActivity?: boolean
    relays?: string[]
    scopeH?: string
    readOnly?: boolean
    allowedAuthors?: string[]
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
  }: Props = $props()

  const path = makeGoalPath(url, event.id)
  const h = getTagValue("h", event.tags)
  const shouldProtect = canEnforceNip70(url)

  const deleteReaction = async (event: TrustedEvent) =>
    publishDelete({relays: relays.length ? relays : [url], event, protect: await shouldProtect})

  const createReaction = async (template: EventContent) =>
    publishReaction({
      ...template,
      event,
      relays: relays.length ? relays : [url],
      tags: [...(template.tags || []), ...(scopeH ? [["h", scopeH]] : [])],
      protect: await shouldProtect,
    })
</script>

<div class="flex flex-grow flex-wrap justify-end gap-2">
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
  <EventActions {url} {relays} {scopeH} {readOnly} {event} hideZap noun="Goal" />
</div>
