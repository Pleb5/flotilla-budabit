<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import Link from "@lib/components/Link.svelte"
  import CalendarEventActions from "@app/components/CalendarEventActions.svelte"
  import CalendarEventHeader from "@app/components/CalendarEventHeader.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import RoomLink from "@app/components/RoomLink.svelte"
  import {makeCalendarPath} from "@app/util/routes"

  type Props = {
    url: string
    event: TrustedEvent
    relays?: string[]
    scopeH?: string
    readOnly?: boolean
    allowedAuthors?: string[]
    showRoom?: boolean
  }

  const {
    url,
    event,
    relays = [],
    scopeH = "",
    readOnly = false,
    allowedAuthors,
    showRoom = false,
  }: Props = $props()

  const h = getTagValue("h", event.tags)
</script>

<div data-event={event.id}>
  <Link class="col-3 card2 bg-alt w-full cursor-pointer shadow-md" href={makeCalendarPath(url, event.id)}>
    <CalendarEventHeader {event} />
    <div class="flex w-full flex-col items-end justify-between gap-2 sm:flex-row">
      <span class="whitespace-nowrap py-1 text-sm opacity-75">
        Posted by <ProfileLink pubkey={event.pubkey} {url} />
        {#if h && showRoom}
          in <RoomLink {url} {h} />
        {/if}
      </span>
      <CalendarEventActions showActivity {url} {relays} {scopeH} {readOnly} {allowedAuthors} {event} />
    </div>
  </Link>
</div>
