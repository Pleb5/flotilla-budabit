<script lang="ts">
  import {browser} from "$app/environment"
  import {goto} from "$app/navigation"
  import {activeCommunitySession} from "@app/core/community-state"
  import {makeCommunityPath} from "@app/util/routes"

  let redirecting = $state(false)

  $effect(() => {
    if (!browser || redirecting) return

    redirecting = true
    const session = $activeCommunitySession
    goto(session ? makeCommunityPath(session.communityPubkey) : "/explore", {replaceState: true})
  })
</script>

<div class="center h-full w-full p-4 text-sm opacity-70">Opening your community...</div>
