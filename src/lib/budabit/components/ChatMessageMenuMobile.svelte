<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import EventInfo from "@lib/budabit/components/EventInfo.svelte"
  import EventDeleteConfirm from "@app/components/EventDeleteConfirm.svelte"
  import {pushModal} from "@app/util/modal"
  import {clip} from "@app/util/toast"
  import Copy from "@assets/icons/copy.svg?dataurl"
  import Code2 from "@assets/icons/code-2.svg?dataurl"
  import TrashBin2 from "@assets/icons/trash-bin-2.svg?dataurl"

  type Props = {
    event: TrustedEvent
    content: string
  }

  const {event, content}: Props = $props()

  const copyText = () => {
    history.back()
    clip(content)
  }

  const showDelete = () => pushModal(EventDeleteConfirm, {event, noun: "Message"})

  const showInfo = () => pushModal(EventInfo, {event}, {replaceState: true})
</script>

<div class="col-2">
  {#if event.pubkey === $pubkey}
    <Button class="btn btn-neutral text-error" onclick={showDelete}>
      <Icon size={4} icon={TrashBin2} />
      Delete Message
    </Button>
  {/if}
  <Button class="btn btn-neutral" onclick={showInfo}>
    <Icon size={4} icon={Code2} />
    Message Info
  </Button>
  <Button class="btn btn-neutral w-full" onclick={copyText}>
    <Icon size={4} icon={Copy} />
    Copy Text
  </Button>
</div>
