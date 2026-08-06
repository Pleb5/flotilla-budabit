<script lang="ts">
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import Link from "@lib/components/Link.svelte"
  import RoomName from "@app/components/RoomName.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActivity from "@app/components/EventActivity.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishSocialDelete, publishReaction} from "@app/core/commands"
  import {makeThreadPath, makeSpacePath} from "@app/util/routes"

  interface Props {
    url: string
    event: TrustedEvent
    showRoom?: boolean
    showActivity?: boolean
    relays?: string[]
    publishRelays?: string[]
    scopeH?: string
    communitySectionName?: string
    readOnly?: boolean
    allowedAuthors?: string[]
    activityLiveCovered?: boolean
  }

  const {
    url,
    event,
    showRoom,
    showActivity,
    relays = [],
    publishRelays = undefined,
    scopeH = "",
    communitySectionName = "",
    readOnly = false,
    allowedAuthors = undefined,
    activityLiveCovered = false,
  }: Props = $props()

  const h = getTagValue("h", event.tags)
  const path = makeThreadPath(url, event.id)
  const actionRelays = $derived(publishRelays ?? (relays.length > 0 ? relays : url ? [url] : []))

  const deleteReaction = async (event: TrustedEvent) =>
    publishSocialDelete({url, relays: actionRelays, event})

  const createReaction = async (template: EventContent) =>
    publishReaction({
      ...template,
      event,
      relays: actionRelays,
      tags: [...(template.tags || []), ...(scopeH ? [["h", scopeH]] : [])],
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
    <EventActivity
      {url}
      {path}
      {event}
      {relays}
      {scopeH}
      {allowedAuthors}
      coreCommunityLiveCovered={activityLiveCovered} />
  {/if}
  <EventActions
    {url}
    relays={actionRelays}
    {scopeH}
    {communitySectionName}
    {readOnly}
    {event}
    noun="Thread"
    allowAdminDelete={false} />
</div>
