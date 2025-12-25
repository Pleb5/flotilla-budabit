<script lang="ts">
  import {removeUndefined} from "@welshman/lib"
  import {deriveProfile} from "@welshman/app"
  import ContentMinimal from "@lib/budabit/components/ContentMinimal.svelte"

  export type Props = {
    pubkey: string
    url?: string
  }

  const {pubkey, url}: Props = $props()

  const profile = deriveProfile(pubkey, removeUndefined([url]))
</script>

{#if $profile}
  <ContentMinimal event={{content: $profile.about || "", tags: []}} />
{/if}
