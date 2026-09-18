<script lang="ts">
  import Link from "@lib/components/Link.svelte"
  import NotificationDot from "@lib/components/NotificationDot.svelte"
  import CardButton from "@lib/components/CardButton.svelte"
  import RelayIcon from "@app/components/RelayIcon.svelte"
  import RelayName from "@app/components/RelayName.svelte"
  import RelayDescription from "@app/components/RelayDescription.svelte"
  import {makeExactCommunityPath, parseExactCommunityRouteParam} from "@app/util/routes"
  import {notifications} from "@app/util/notifications"

  const {url} = $props()

  const community = $derived(parseExactCommunityRouteParam(url))
  const path = $derived(community ? makeExactCommunityPath(community) : "/explore")
</script>

<Link replaceState href={path}>
  <CardButton class="btn-neutral shadow-md">
    {#snippet icon()}
      <RelayIcon {url} size={12} />
    {/snippet}
    {#snippet title()}
      <div class="flex gap-1">
        <RelayName {url} />
        {#if $notifications.has(path)}
          <NotificationDot class="relative top-1" />
        {/if}
      </div>
    {/snippet}
    {#snippet info()}
      <div><RelayDescription {url} /></div>
    {/snippet}
  </CardButton>
</Link>
