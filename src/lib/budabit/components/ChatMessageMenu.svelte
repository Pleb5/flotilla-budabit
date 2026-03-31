<script lang="ts">
  import {pubkey} from "@welshman/app"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import EventInfo from "@lib/budabit/components/EventInfo.svelte"
  import EventDeleteConfirm from "@app/components/EventDeleteConfirm.svelte"
  import {pushModal} from "@app/util/modal"
  import Code2 from "@assets/icons/code-2.svg?dataurl"
  import TrashBin2 from "@assets/icons/trash-bin-2.svg?dataurl"

  const {event, popover} = $props()

  const showInfo = () => {
    popover.hide()
    pushModal(EventInfo, {event})
  }

  const showDelete = () => {
    popover.hide()
    pushModal(EventDeleteConfirm, {event, noun: "Message"})
  }
</script>

<div class="join border border-solid border-neutral text-xs">
  {#if event.pubkey === $pubkey}
    <Button class="btn join-item btn-xs text-error" onclick={showDelete}>
      <Icon size={4} icon={TrashBin2} />
    </Button>
  {/if}
  <Button class="btn join-item btn-xs" onclick={showInfo}>
    <Icon size={4} icon={Code2} />
  </Button>
</div>
