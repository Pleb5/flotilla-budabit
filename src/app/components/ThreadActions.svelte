<script lang="ts">
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import RoomName from "@app/components/RoomName.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActivity from "@app/components/EventActivity.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishReactionDeleteOperation, publishReactionOperation} from "@app/core/commands"
  import {makeExactCommunityThreadPath} from "@app/util/routes"
  import type {CommunityPointer} from "@app/core/community"

  interface Props {
    url: string
    community?: CommunityPointer
    event: TrustedEvent
    showRoom?: boolean
    showActivity?: boolean
    relays?: string[]
    publishRelays?: string[]
    scopeH?: string
    communitySectionName?: string
    readOnly?: boolean
    allowedAuthors?: string[]
    reactionAllowedAuthors?: string[]
    reportAllowedAuthors?: string[]
    activityLiveCovered?: boolean
  }

  const {
    url,
    community,
    event,
    showRoom,
    showActivity,
    relays = [],
    publishRelays = undefined,
    scopeH = "",
    communitySectionName = "",
    readOnly = false,
    allowedAuthors = undefined,
    reactionAllowedAuthors = undefined,
    reportAllowedAuthors = undefined,
    activityLiveCovered = false,
  }: Props = $props()

  const h = getTagValue("h", event.tags)
  const path = community ? makeExactCommunityThreadPath(community, event.id) : ""
  const actionRelays = $derived(
    publishRelays ?? (relays.length > 0 ? relays : !scopeH && url ? [url] : []),
  )

  const deleteReaction = async (reaction: TrustedEvent) =>
    publishReactionDeleteOperation({reaction, relays: actionRelays})

  const createReaction = async (template: EventContent) =>
    publishReactionOperation({
      ...template,
      event,
      relays: actionRelays,
      tags: [...(template.tags || []), ...(scopeH ? [["h", scopeH]] : [])],
    })
</script>

<div class="flex flex-grow flex-wrap justify-end gap-2">
  {#if h && showRoom}
    <span class="btn btn-neutral btn-xs rounded-full">Posted in #<RoomName {h} {url} /></span>
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
  <ReactionSummary
    {url}
    {relays}
    operationRelays={actionRelays}
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
</div>
