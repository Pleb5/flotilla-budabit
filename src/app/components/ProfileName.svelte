<script lang="ts">
  import {deriveBudabitProfileDisplay} from "@app/core/profile-resolver"

  type Props = {
    pubkey: string
    url?: string
    relays?: string[]
  }

  const {pubkey, url, relays = []}: Props = $props()

  const profileDisplay = $derived(deriveBudabitProfileDisplay(pubkey, {url, relays}))
</script>

{$profileDisplay}
