<script lang="ts">
  import {removeUndefined} from "@welshman/lib"
  import type {ProfilePointer} from "@welshman/content"
  import Button from "@lib/components/Button.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {deriveBudabitProfileDisplay} from "@app/core/profile-resolver"
  import {pushModal} from "@app/util/modal"

  type Props = {
    value: ProfilePointer
    url?: string
  }

  const {value, url}: Props = $props()

  const getRelayHints = () => removeUndefined([url, ...(((value as any).relays || []) as string[])])
  const display = deriveBudabitProfileDisplay(value.pubkey, {url, relays: getRelayHints()})

  const openProfile = () => {
    const relays = getRelayHints()
    pushModal(ProfileDetail, {pubkey: value.pubkey, url: relays[0], relays})
  }
</script>

<Button onclick={openProfile} class="link-content">
  @{$display}
</Button>
