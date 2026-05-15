<script lang="ts">
  import {max, formatTimestampRelative} from "@welshman/lib"
  import {COMMENT} from "@welshman/util"
  import {request} from "@welshman/net"
  import {deriveArray, deriveEventsById} from "@welshman/store"
  import type {TrustedEvent} from "@welshman/util"
  import {repository} from "@welshman/app"
  import {notifications} from "@app/util/notifications"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"

  const {
    url,
    path,
    event,
    relays = [],
    scopeH = "",
    allowedAuthors = undefined,
  }: {
    url: string
    path: string
    event: TrustedEvent
    relays?: string[]
    scopeH?: string
    allowedAuthors?: string[]
  } = $props()

  const loadRelays = $derived.by(() =>
    (relays.length > 0 ? relays : url ? [url] : []).filter(Boolean),
  )
  const filters = $derived.by(() => {
    if (allowedAuthors?.length === 0) return []

    return [
      {
        kinds: [COMMENT],
        "#E": [event.id],
        "#K": [String(event.kind)],
        ...(scopeH ? {"#h": [scopeH]} : {}),
        ...(allowedAuthors ? {authors: allowedAuthors} : {}),
      },
    ]
  })
  const replies = $derived(deriveArray(deriveEventsById({repository, filters})))
  const lastActive = $derived(max([...$replies, event].map(e => e.created_at)))

  $effect(() => {
    if (loadRelays.length === 0 || filters.length === 0) return

    const controller = new AbortController()
    request({relays: loadRelays, filters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

<div class="flex-inline btn btn-neutral btn-xs gap-1 rounded-full">
  <Icon icon={Reply} />
  <span>{$replies.length} {$replies.length === 1 ? "reply" : "replies"}</span>
</div>
<div class="btn btn-neutral btn-xs relative hidden rounded-full sm:flex">
  {#if $notifications.has(path)}
    <div class="h-2 w-2 rounded-full bg-primary"></div>
  {/if}
  Active {formatTimestampRelative(lastActive)}
</div>
