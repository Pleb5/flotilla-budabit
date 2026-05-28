<script lang="ts">
  import ShareCircle from "@assets/icons/share-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import {makeCommunityNcommunity, normalizeRelays} from "@app/core/community"
  import {clip} from "@app/util/toast"

  type Props = {
    communityPubkey: string
    relayHints?: string[]
    class?: string
  }

  const {
    communityPubkey,
    relayHints = [],
    class: className = "btn btn-square btn-sm",
  }: Props = $props()

  const relays = $derived(normalizeRelays(relayHints))
  const shareValue = $derived(makeCommunityNcommunity({pubkey: communityPubkey, relayHints: relays}))

  const shareCommunity = () => {
    if (!shareValue) return

    clip(shareValue, "Community link copied!")
  }
</script>

<button
  type="button"
  class={className}
  disabled={!shareValue}
  aria-label="Share community"
  title="Share community"
  onclick={shareCommunity}>
  <Icon icon={ShareCircle} />
</button>
