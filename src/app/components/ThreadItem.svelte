<script lang="ts">
  import {formatTimestamp} from "@welshman/lib"
  import type {TrustedEvent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import Link from "@lib/components/Link.svelte"
  import Content from "@app/components/Content.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import ThreadActions from "@app/components/ThreadActions.svelte"
  import {makeThreadPath} from "@app/util/routes"

  type Props = {
    url: string
    event: TrustedEvent
    relays?: string[]
    scopeH?: string
    readOnly?: boolean
    allowedAuthors?: string[]
  }

  const {
    url,
    event,
    relays = [],
    scopeH = "",
    readOnly = false,
    allowedAuthors = undefined,
  }: Props = $props()

  const title = getTagValue("title", event.tags)
</script>

<Link
  class="col-2 card2 bg-alt relative w-full cursor-pointer shadow-xl"
  href={makeThreadPath(url, event.id)}>
  {#if title}
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
  <Content {event} {url} expandMode="inline" />
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
</Link>
