<script lang="ts">
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import EventInfo from "@app/components/EventInfo.svelte"
  import {pushModal} from "@app/util/modal"

  const {url, event} = $props()

  const showInfo = () => pushModal(EventInfo, {url, event}, {replaceState: true})
</script>

<Button class="btn join-item btn-xs" onclick={showInfo}>
  <Icon icon={MenuDots} size={4} />
</Button>
