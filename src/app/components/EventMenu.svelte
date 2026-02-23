<script lang="ts">
  import {onMount} from "svelte"
  import type {Snippet} from "svelte"
  import type {TrustedEvent} from "@welshman/util"
  import {Address, COMMENT, ManagementMethod, isReplaceable} from "@welshman/util"
  import * as nip19 from "nostr-tools/nip19"
  import {pubkey, repository, manageRelay} from "@welshman/app"
  import ShareCircle from "@assets/icons/share-circle.svg?dataurl"
  import Code2 from "@assets/icons/code-2.svg?dataurl"
  import TrashBin2 from "@assets/icons/trash-bin-2.svg?dataurl"
  import Danger from "@assets/icons/danger.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import EventInfo from "@app/components/EventInfo.svelte"
  import Report from "@app/components/Report.svelte"
  import EventDeleteConfirm from "@app/components/EventDeleteConfirm.svelte"
  import IssueDeleteConfirm from "@app/components/IssueDeleteConfirm.svelte"
  import {deriveUserIsSpaceAdmin} from "@app/core/state"
  import {pushModal} from "@app/util/modal"
  import {clip, pushToast} from "@app/util/toast"

  type Props = {
    url: string
    noun: string
    event: TrustedEvent
    onClick: () => void
    customActions?: Snippet
    relays?: string[]
  }

  const {url, noun, event, onClick, customActions, relays = []}: Props = $props()

  const isRoot = event.kind !== COMMENT
  const userIsAdmin = deriveUserIsSpaceAdmin(url)

  const report = () => pushModal(Report, {url, event})

  const showInfo = () => pushModal(EventInfo, {url, event})

  const share = () => {
    const relays = url ? [url] : []
    const nostrURI = isReplaceable(event)
      ? Address.fromEvent(event).toNaddr()
      : nip19.neventEncode({...event, relays})

    clip(nostrURI)
  }

  const showDelete = () => {
    if (event.kind === 1621) {
      const deleteRelays = relays.length > 0 ? relays : url ? [url] : []
      pushModal(IssueDeleteConfirm, {event, relays: deleteRelays})
      return
    }
    pushModal(EventDeleteConfirm, {url, event})
  }

  const showAdminDelete = () =>
    pushModal(Confirm, {
      title: `Delete ${noun}`,
      message: `Are you sure you want to delete this ${noun.toLowerCase()} from the space?`,
      confirm: async () => {
        const {error} = await manageRelay(url, {
          method: ManagementMethod.BanEvent,
          params: [event.id],
        })

        if (error) {
          pushToast({theme: "error", message: error})
        } else {
          pushToast({message: "Event has successfully been deleted!"})
          repository.removeEvent(event.id)
          history.back()
        }
      },
    })

  let ul: Element

  onMount(() => {
    ul.addEventListener("click", onClick)
  })
</script>

<ul class="menu whitespace-nowrap rounded-box bg-base-100 p-2 shadow-md" bind:this={ul}>
  {#if isRoot}
    <li>
      <Button onclick={share}>
        <Icon size={4} icon={ShareCircle} />
        Share
      </Button>
    </li>
  {/if}
  <li>
    <Button onclick={showInfo}>
      <Icon size={4} icon={Code2} />
      {noun} Details
    </Button>
  </li>
  {@render customActions?.()}
  {#if event.pubkey === $pubkey}
    <li>
      <Button onclick={showDelete} class="text-error">
        <Icon size={4} icon={TrashBin2} />
        Delete {noun}
      </Button>
    </li>
  {:else}
    <li>
      <Button class="text-error" onclick={report}>
        <Icon size={4} icon={Danger} />
        Report Content
      </Button>
    </li>
    {#if $userIsAdmin}
      <li>
        <Button class="text-error" onclick={showAdminDelete}>
          <Icon size={4} icon={TrashBin2} />
          Delete {noun}
        </Button>
      </li>
    {/if}
  {/if}
</ul>
