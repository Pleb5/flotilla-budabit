<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import EventInfo from "@lib/budabit/components/EventInfo.svelte"
  import {pushModal} from "@app/util/modal"
  import {clip} from "@app/util/toast"
  import Copy from "@assets/icons/copy.svg?dataurl"
  import Code2 from "@assets/icons/code-2.svg?dataurl"

  type Props = {
    event: TrustedEvent
    content: string
  }

  const {event, content}: Props = $props()

  const copyText = () => {
    history.back()
    clip(content)
  }

  const showInfo = () => pushModal(EventInfo, {event}, {replaceState: true})
</script>

<div class="col-2">
  <Button class="btn btn-neutral" onclick={showInfo}>
    <Icon size={4} icon={Code2} />
    Message Info
  </Button>
  <Button class="btn btn-neutral w-full" onclick={copyText}>
    <Icon size={4} icon={Copy} />
    Copy Text
  </Button>
</div>
