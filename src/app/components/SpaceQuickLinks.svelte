<script lang="ts">
  import NotificationDot from "@lib/components/NotificationDot.svelte"
  import CompassBig from "@assets/icons/compass-big.svg?dataurl"
  import StarFallMinimalistic from "@assets/icons/star-fall-minimalistic.svg?dataurl"
  import ChatRound from "@assets/icons/chat-round.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import {makeExactCommunityPath, parseExactCommunityRouteParam} from "@app/util/routes"
  import {notifications} from "@app/util/notifications"

  type Props = {
    url: string
  }

  const {url}: Props = $props()
  const community = $derived(parseExactCommunityRouteParam(url))
  const chatPath = $derived(community ? makeExactCommunityPath(community, "rooms") : "/explore")
  const goalsPath = $derived(community ? makeExactCommunityPath(community, "goals") : "/explore")
</script>

<div class="card2 bg-alt md:hidden">
  <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
    <Icon icon={CompassBig} />
    Quick Links
  </h3>
  <div class="flex flex-col gap-2">
    <Link href={chatPath} class="btn btn-neutral w-full justify-start">
      <div class="relative flex items-center gap-2">
        <Icon icon={ChatRound} />
        Chat
        {#if $notifications.has(chatPath)}
          <NotificationDot class="absolute -right-3 -top-1" />
        {/if}
      </div>
    </Link>
    <Link href={goalsPath} class="btn btn-neutral w-full justify-start">
      <div class="relative flex items-center gap-2">
        <Icon icon={StarFallMinimalistic} />
        Goals
        {#if $notifications.has(goalsPath)}
          <NotificationDot class="absolute -right-3 -top-1" />
        {/if}
      </div>
    </Link>
  </div>
</div>
