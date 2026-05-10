<script lang="ts">
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import ImageIcon from "@lib/components/ImageIcon.svelte"
  import {deriveChannel, deriveRoom} from "@app/core/state"

  interface Props {
    h: string
    url: string
    size?: number
  }

  const {url, h, size = 5}: Props = $props()

  const room = deriveRoom(url, h)
  const channel = deriveChannel(url, h)
  const picture = $derived($channel?.picture || $room.picture)
</script>

{#if picture}
  <ImageIcon src={picture} {size} alt="" class="rounded-lg" />
{:else}
  <Icon icon={Hashtag} {size} />
{/if}
