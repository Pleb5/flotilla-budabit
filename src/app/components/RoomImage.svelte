<script lang="ts">
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import ImageIcon from "@lib/components/ImageIcon.svelte"
  import type {CommunityRoomRoot} from "@app/core/community-rooms"

  interface Props {
    h?: string
    url?: string
    room?: CommunityRoomRoot
    size?: number
  }

  const {h, room, size = 5}: Props = $props()

  const picture = $derived(room?.event.tags.find(tag => tag[0] === "picture")?.[1] || "")
  const label = $derived(room?.name || h || "Room")
</script>

{#if picture}
  <ImageIcon src={picture} {size} alt={label} class="rounded-lg" />
{:else}
  <Icon icon={Hashtag} {size} />
{/if}
