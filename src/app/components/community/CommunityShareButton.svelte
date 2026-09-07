<script lang="ts">
  import ShareCircle from "@assets/icons/share-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import {makeCommunityPointer, type CommunityPointer} from "@app/core/community"
  import {clip} from "@app/util/toast"

  type Props = {
    value: CommunityPointer
    definitionRelays?: string[]
    class?: string
  }

  const {value, definitionRelays = [], class: className = "btn btn-square btn-sm"}: Props = $props()

  const shareValue = $derived(
    makeCommunityPointer({
      ownerPubkey: value.ownerPubkey,
      communityId: value.communityId,
      relayHints: definitionRelays,
    })?.naddr || value.naddr,
  )

  const shareCommunity = () => {
    if (!shareValue) return

    clip(shareValue)
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
