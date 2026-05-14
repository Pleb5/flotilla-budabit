<script lang="ts">
  import {removeUndefined} from "@welshman/lib"
  import {deriveProfile} from "@welshman/app"
  import ContentMinimal from "@app/components/ContentMinimal.svelte"

  export type Props = {
    pubkey: string
    url?: string
    relays?: string[]
  }

  const {pubkey, url, relays = []}: Props = $props()

  const relayHints = $derived(removeUndefined([url, ...relays]))
  const profile = $derived(deriveProfile(pubkey, relayHints))
</script>

{#if $profile}
  <ContentMinimal event={{content: $profile.about || "", tags: []}} />
{/if}
