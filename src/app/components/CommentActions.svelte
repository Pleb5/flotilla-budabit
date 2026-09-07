<script lang="ts">
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActivity from "@app/components/EventActivity.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishReactionDeleteOperation, publishReactionOperation} from "@app/core/commands"

  interface Props {
    url: any
    event: any
    showActivity?: boolean
    noun?: string
    path?: string
    reply?: () => void
    edit?: () => void
  }

  const {
    url,
    event,
    showActivity = false,
    noun = "Comment",
    path = "",
    reply,
    edit,
  }: Props = $props()

  const deleteReaction = async (reaction: TrustedEvent) =>
    publishReactionDeleteOperation({reaction, relays: [url]})

  const createReaction = async (template: EventContent) =>
    publishReactionOperation({...template, event, relays: [url]})
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
  <div class="flex flex-grow flex-wrap justify-end gap-2">
    <EventActions
      {url}
      {event}
      {noun}
      {reply}
      {edit}
      menuOnly
      infoLabel="Message Info"
      showReport={false}
      allowAdminDelete={false} />
    <ReactionSummary {url} {event} {deleteReaction} {createReaction} reactionClass="tooltip-left" />
    <ThunkStatusOrDeleted {event} />
    {#if showActivity}
      <EventActivity {url} {path} {event} />
    {/if}
  </div>
</div>
