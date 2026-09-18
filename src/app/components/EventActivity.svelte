<script lang="ts">
  import {max, formatTimestampRelative} from "@welshman/lib"
  import {COMMENT, getAddress, isReplaceable} from "@welshman/util"
  import {deriveArray, deriveEventsById} from "@welshman/store"
  import type {Filter, TrustedEvent} from "@welshman/util"
  import {repository} from "@welshman/app"
  import {page} from "$app/stores"
  import {makeCommunityScopedFilterPlan} from "@app/core/community-feeds"
  import {registerEventActivity} from "@app/core/event-activity-io"
  import {notifications} from "@app/util/notifications"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import NotificationDot from "@lib/components/NotificationDot.svelte"

  const {
    url,
    path,
    event,
    relays = [],
    scopeH = "",
    allowedAuthors = undefined,
    coreCommunityLiveCovered = false,
  }: {
    url: string
    path: string
    event: TrustedEvent
    relays?: string[]
    scopeH?: string
    allowedAuthors?: string[]
    coreCommunityLiveCovered?: boolean
  } = $props()

  const loadRelays = $derived.by(() =>
    (relays.length > 0 ? relays : !scopeH && url ? [url] : []).filter(Boolean),
  )
  const rootFilterPlan = $derived.by(() => {
    const rootFilter = {
      kinds: [COMMENT],
      "#K": [String(event.kind)],
    } satisfies Filter
    const structuralFilters: Filter[] = [{...rootFilter, "#E": [event.id]}]

    if (isReplaceable(event)) {
      const address = getAddress(event)

      structuralFilters.push({...rootFilter, "#A": [address]})
    }

    return makeCommunityScopedFilterPlan(structuralFilters, scopeH, allowedAuthors)
  })
  const directReplyFilterPlan = $derived.by(() => {
    const directReplyFilter = {
      kinds: [COMMENT],
      "#k": [String(event.kind)],
    } satisfies Filter
    const structuralFilters: Filter[] = [{...directReplyFilter, "#e": [event.id]}]

    if (isReplaceable(event)) {
      structuralFilters.push({...directReplyFilter, "#a": [getAddress(event)]})
    }

    return makeCommunityScopedFilterPlan(structuralFilters, scopeH, allowedAuthors)
  })
  const filters = $derived([...rootFilterPlan.localFilters, ...directReplyFilterPlan.localFilters])
  let replies = $state<TrustedEvent[]>([])
  const lastActive = $derived(max([...replies, event].map(e => e.created_at)))
  const routeScope = $derived(`${$page.route.id || "unknown"}:${$page.url.pathname}`)

  $effect(() => {
    const replyStore = deriveArray(deriveEventsById({repository, filters}))

    return replyStore.subscribe(events => (replies = events))
  })

  $effect(() => {
    if (loadRelays.length === 0) return

    const releases = [rootFilterPlan, directReplyFilterPlan].map(plan =>
      registerEventActivity({
        routeScope,
        relays: loadRelays,
        scopeH,
        filters: plan.localFilters,
        ...(scopeH ? {relayFilters: plan.relayFilters} : {}),
        coreCommunityLiveCovered,
      }),
    )

    return () => releases.forEach(release => release())
  })
</script>

<div class="flex-inline btn btn-neutral btn-xs gap-1 rounded-full">
  <Icon icon={Reply} />
  <span>
    {replies.length}
    {replies.length === 1 ? "reply" : "replies"}
  </span>
</div>
<div class="btn btn-neutral btn-xs relative hidden rounded-full sm:flex">
  {#if $notifications.has(path)}
    <NotificationDot />
  {/if}
  Active {formatTimestampRelative(lastActive)}
</div>
