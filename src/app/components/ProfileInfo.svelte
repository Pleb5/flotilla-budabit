<script lang="ts">
  import ContentMinimal from "@app/components/ContentMinimal.svelte"
  import {deriveBudabitProfile} from "@app/core/profile-resolver"

  export type Props = {
    pubkey: string
    url?: string
    relays?: string[]
  }

  const {pubkey, url, relays = []}: Props = $props()

  const profile = $derived(deriveBudabitProfile(pubkey, {url, relays}))
</script>

{#if $profile}
  <ContentMinimal event={{content: $profile.about || "", tags: []}} />
{/if}
