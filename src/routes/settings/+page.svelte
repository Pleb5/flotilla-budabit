<script lang="ts">
  import {goto} from "$app/navigation"
  import {pubkey} from "@welshman/app"
  import MenuSettings from "@app/components/MenuSettings.svelte"
  import Link from "@lib/components/Link.svelte"
  import {makeProfilePath} from "@app/util/routes"

  const profilePath = $derived($pubkey ? makeProfilePath($pubkey) : "")

  $effect(() => {
    if (profilePath) goto(profilePath, {replaceState: true}).catch(() => undefined)
  })
</script>

<div class="content column gap-4">
  {#if profilePath}
    <div class="card2 bg-alt shadow-md">
      <p class="opacity-75">Opening your full profile...</p>
      <Link href={profilePath} class="btn btn-primary btn-sm mt-4 w-fit">Open profile</Link>
    </div>
  {:else}
    <MenuSettings />
  {/if}
</div>
