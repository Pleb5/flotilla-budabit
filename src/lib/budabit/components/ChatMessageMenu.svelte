<script lang="ts">
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import EventInfo from "@lib/budabit/components/EventInfo.svelte"
  import {pushModal} from "@app/util/modal"
  import Code2 from "@assets/icons/code-2.svg?dataurl"

  const {event, popover} = $props()

  const showInfo = () => {
    popover.hide()
    pushModal(EventInfo, {event})
  }
</script>

<div class="join border border-solid border-neutral text-xs">
  <Button class="btn join-item btn-xs" onclick={showInfo}>
    <Icon size={4} icon={Code2} />
  </Button>
</div>
