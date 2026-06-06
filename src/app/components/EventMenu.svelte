<script lang="ts">
  import {onMount} from "svelte"
  import type {Snippet} from "svelte"
  import type {TrustedEvent} from "@welshman/util"
  import {COMMENT} from "@welshman/util"
  import {GIT_PULL_REQUEST, GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"
  import {pubkey} from "@welshman/app"
  import ShareCircle from "@assets/icons/share-circle.svg?dataurl"
  import Code2 from "@assets/icons/code-2.svg?dataurl"
  import TrashBin2 from "@assets/icons/trash-bin-2.svg?dataurl"
  import Danger from "@assets/icons/danger.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import EventInfo from "@app/components/EventInfo.svelte"
  import Report from "@app/components/Report.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import ModerationAction from "@app/components/community/ModerationAction.svelte"
  import EventDeleteConfirm from "@app/components/EventDeleteConfirm.svelte"
  import IssueDeleteConfirm from "@app/components/IssueDeleteConfirm.svelte"
  import PullRequestDeleteConfirm from "@app/components/PullRequestDeleteConfirm.svelte"
  import {pushModal} from "@app/util/modal"
  import {clip, pushToast} from "@app/util/toast"
  import {publishReport} from "@app/core/commands"
  import {makeEventShareEntityForEvent} from "@app/util/event-share"

  type Props = {
    url: string
    noun: string
    event: TrustedEvent
    onClick: () => void
    customActions?: Snippet
    relays?: string[]
    scopeH?: string
    communitySectionName?: string
    ownerPubkey?: string
    showReport?: boolean
    showModeration?: boolean
  }

  const {
    url,
    noun,
    event,
    onClick,
    customActions,
    relays = [],
    communitySectionName = "",
    ownerPubkey = "",
    showReport = true,
    showModeration = true,
  }: Props = $props()

  const isRoot = event.kind !== COMMENT
  const canDeleteEvent = event.kind !== GIT_REPO_ANNOUNCEMENT
  const report = () => pushModal(Report, {url, event})

  const publishHideSpam = () => {
    const reportRelays = relays.length > 0 ? relays : url ? [url] : []
    if (reportRelays.length === 0) return
    publishReport({event, reason: "spam", content: "", relays: reportRelays})
    pushToast({message: `${noun} hidden from BudaBit users.`})
    history.back()
  }

  const hideSpam = () => {
    pushModal(Confirm, {
      title: "Hide spam",
      message: `This will hide this ${noun.toLowerCase()} from BudaBit users.`,
      confirm: publishHideSpam,
      confirmLabel: "Hide spam",
    })
  }

  const showInfo = () => pushModal(EventInfo, {url, event, relays})

  const share = () => {
    clip(makeEventShareEntityForEvent(event, {url, relays}))
  }

  const showDelete = () => {
    if (event.kind === 1621) {
      const deleteRelays = relays.length > 0 ? relays : url ? [url] : []
      pushModal(IssueDeleteConfirm, {event, relays: deleteRelays})
      return
    }
    if (event.kind === GIT_PULL_REQUEST) {
      const deleteRelays = relays.length > 0 ? relays : url ? [url] : []
      pushModal(PullRequestDeleteConfirm, {event, relays: deleteRelays})
      return
    }
    pushModal(EventDeleteConfirm, {url, event, noun})
  }

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
  {@render customActions?.()}
  <li>
    <Button onclick={showInfo}>
      <Icon size={4} icon={Code2} />
      {noun} Details
    </Button>
  </li>
  {#if event.pubkey === $pubkey}
    {#if canDeleteEvent}
      <li>
        <Button onclick={showDelete} class="text-error">
          <Icon size={4} icon={TrashBin2} />
          Delete {noun}
        </Button>
      </li>
    {/if}
  {/if}
  {#if ownerPubkey && ownerPubkey === $pubkey && event.pubkey !== $pubkey && showReport && !communitySectionName}
    <li>
      <Button class="text-error" onclick={hideSpam}>
        <Icon size={4} icon={Danger} />
        Hide spam
      </Button>
    </li>
  {:else if event.pubkey !== $pubkey && showReport && !communitySectionName}
    <li>
      <Button class="text-error" onclick={report}>
        <Icon size={4} icon={Danger} />
        Report Content
      </Button>
    </li>
  {/if}
  {#if showModeration}
    <ModerationAction {event} sectionName={communitySectionName} {onClick} />
  {/if}
</ul>
