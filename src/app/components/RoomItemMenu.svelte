<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import Code2 from "@assets/icons/code-2.svg?dataurl"
  import TrashBin2 from "@assets/icons/trash-bin-2.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import EventInfo from "@app/components/EventInfo.svelte"
  import ModerationAction from "@app/components/community/ModerationAction.svelte"
  import EventDeleteConfirm from "@app/components/EventDeleteConfirm.svelte"
  import {pushModal} from "@app/util/modal"

  type Props = {
    url: string
    event: TrustedEvent
    onClick: () => void
    readOnly?: boolean
    relays?: string[]
    communitySectionName?: string
  }

  const {
    url,
    event,
    onClick,
    readOnly = false,
    relays = [],
    communitySectionName = "",
  }: Props = $props()

  const showInfo = () => {
    onClick()
    pushModal(EventInfo, {url, event})
  }

  const showDelete = () => {
    onClick()
    pushModal(EventDeleteConfirm, {
      url,
      relays,
      event,
      noun: "Message",
    })
  }
</script>

<ul class="menu whitespace-nowrap rounded-box bg-base-100 p-2 shadow-md">
  <li>
    <Button onclick={showInfo}>
      <Icon size={4} icon={Code2} />
      Show JSON
    </Button>
  </li>
  {#if event.pubkey === $pubkey && !readOnly}
    <li>
      <Button onclick={showDelete} class="text-error">
        <Icon size={4} icon={TrashBin2} />
        Delete Message
      </Button>
    </li>
  {/if}
  <ModerationAction {event} sectionName={communitySectionName} {onClick} />
</ul>
