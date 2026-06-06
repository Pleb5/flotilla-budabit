<script lang="ts">
  import {formatTimestamp} from "@welshman/lib"
  import type {TrustedEvent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import Link from "@lib/components/Link.svelte"
  import Content from "@app/components/Content.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import ThreadActions from "@app/components/ThreadActions.svelte"
  import {activeCommunityReportState} from "@app/core/community-state"
  import {
    getCommunityCensorReason,
    getCommunityReportEventAddress,
  } from "@app/core/community-reports"
  import {makeThreadPath} from "@app/util/routes"

  type Props = {
    url: string
    event: TrustedEvent
    relays?: string[]
    scopeH?: string
    communitySectionName?: string
    readOnly?: boolean
    allowedAuthors?: string[]
  }

  const {
    url,
    event,
    relays = [],
    scopeH = "",
    communitySectionName = "",
    readOnly = false,
    allowedAuthors = undefined,
  }: Props = $props()

  const title = getTagValue("title", event.tags)
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

<Link
  class="col-2 card2 bg-alt relative w-full cursor-pointer shadow-xl"
  href={makeThreadPath(url, event.id)}>
  {#if censorReason}
    <ModeratedContent reason={censorReason} />
  {:else if title}
    <p class="min-w-0 break-words text-xl">{title}</p>
  {/if}
  {#if !censorReason}
    <Content {event} {url} {communitySectionName} expandMode="inline" />
    <div class="flex w-full flex-wrap items-end justify-between gap-2">
      <div class="flex flex-col items-start gap-1 py-1 text-sm opacity-75">
        <span class="whitespace-nowrap">
          Posted by
          <ProfileLink pubkey={event.pubkey} {url} />
        </span>
        <span>{formatTimestamp(event.created_at)}</span>
      </div>
      <ThreadActions
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
