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
  import {getCommunityCensorReason} from "@app/core/community-reports"
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
    <div class="flex w-full items-center justify-between gap-2 pr-12 sm:pr-0">
      <p class="text-xl">{title}</p>
      <p class="text-sm opacity-75">
        {formatTimestamp(event.created_at)}
      </p>
    </div>
  {:else}
    <p class="mb-3 h-0 text-xs opacity-75">
      {formatTimestamp(event.created_at)}
    </p>
  {/if}
  {#if !censorReason}
    <Content {event} {url} {communitySectionName} expandMode="inline" />
    <div class="flex w-full flex-col items-end justify-between gap-2 sm:flex-row">
      <span class="whitespace-nowrap py-1 text-sm opacity-75">
        Posted by
        <ProfileLink pubkey={event.pubkey} {url} />
      </span>
      <ThreadActions
        showActivity
        floatMobileMenu
        {url}
        {relays}
        {scopeH}
        {readOnly}
        {allowedAuthors}
        {event} />
    </div>
  {/if}
</Link>
