<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import Link from "@lib/components/Link.svelte"
  import Content from "@app/components/Content.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import GoalActions from "@app/components/GoalActions.svelte"
  import GoalSummary from "@app/components/GoalSummary.svelte"
  import RoomLink from "@app/components/RoomLink.svelte"
  import {activeCommunityReportState} from "@app/core/community-state"
  import {
    getCommunityCensorReason,
    getCommunityReportEventAddress,
  } from "@app/core/community-reports"
  import {makeGoalPath} from "@app/util/routes"

  type Props = {
    url: string
    event: TrustedEvent
    relays?: string[]
    scopeH?: string
    communitySectionName?: string
    readOnly?: boolean
    allowedAuthors?: string[]
    showRoom?: boolean
  }

  const {
    url,
    event,
    relays = [],
    scopeH = "",
    communitySectionName = "",
    readOnly = false,
    allowedAuthors = undefined,
    showRoom = false,
  }: Props = $props()

  const summary = getTagValue("summary", event.tags)
  const h = getTagValue("h", event.tags)
  const censorReason = $derived.by(() =>
    communitySectionName
      ? getCommunityCensorReason({
          reportState: $activeCommunityReportState,
          eventId: event.id,
          eventAddress: getCommunityReportEventAddress(event),
          pubkey: event.pubkey,
          sectionName: communitySectionName,
        })
      : undefined,
  )
</script>

<div data-event={event.id}>
  <Link
    class="col-2 card2 bg-alt w-full cursor-pointer shadow-md"
    href={makeGoalPath(url, event.id)}>
    {#if censorReason}
      <ModeratedContent reason={censorReason} />
    {:else}
      <p class="text-2xl">{event.content}</p>
      <Content
        event={{content: summary, tags: event.tags}}
        {url}
        {communitySectionName}
        expandMode="inline"
        minLength={50}
        maxLength={300} />
      <GoalSummary {url} {event} {relays} {scopeH} />
      <div class="flex w-full flex-col items-end justify-between gap-2 sm:flex-row">
        <span class="whitespace-nowrap py-1 text-sm opacity-75">
          Posted by <ProfileLink pubkey={event.pubkey} {url} />
          {#if h && showRoom}
            in <RoomLink {url} {h} />
          {/if}
        </span>
        <GoalActions
          showActivity
          {url}
          {relays}
          {scopeH}
          {communitySectionName}
          {readOnly}
          {allowedAuthors}
          {event} />
      </div>
    {/if}
  </Link>
</div>
