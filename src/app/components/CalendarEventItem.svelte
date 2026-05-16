<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import Link from "@lib/components/Link.svelte"
  import CalendarEventActions from "@app/components/CalendarEventActions.svelte"
  import CalendarEventHeader from "@app/components/CalendarEventHeader.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import RoomLink from "@app/components/RoomLink.svelte"
  import {activeCommunityReportState} from "@app/core/community-state"
  import {getCommunityCensorReason} from "@app/core/community-reports"
  import {makeCalendarPath} from "@app/util/routes"

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
    allowedAuthors,
    showRoom = false,
  }: Props = $props()

  const h = getTagValue("h", event.tags)
  const eventRouteParam = getTagValue("d", event.tags) || event.id
  const censorReason = $derived.by(() =>
    communitySectionName
      ? getCommunityCensorReason({
          reportState: $activeCommunityReportState,
          eventId: event.id,
          pubkey: event.pubkey,
          sectionName: communitySectionName,
        })
      : undefined,
  )
</script>

<div data-event={event.id}>
  <Link
    class="col-3 card2 bg-alt w-full cursor-pointer shadow-md"
    href={makeCalendarPath(url, eventRouteParam)}>
    {#if censorReason}
      <ModeratedContent reason={censorReason} />
    {:else}
      <CalendarEventHeader {event} />
      <div class="flex w-full flex-col items-end justify-between gap-2 sm:flex-row">
        <span class="whitespace-nowrap py-1 text-sm opacity-75">
          Posted by <ProfileLink pubkey={event.pubkey} {url} />
          {#if h && showRoom}
            in <RoomLink {url} {h} />
          {/if}
        </span>
        <CalendarEventActions
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
