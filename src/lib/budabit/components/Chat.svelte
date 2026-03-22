<script lang="ts">
  import type {Snippet} from "svelte"
  import {onMount} from "svelte"
  import {
    int,
    sortBy,
    remove,
    formatTimestampAsDate,
    MINUTE,
    uniq,
  } from "@welshman/lib"
  import type {TrustedEvent, EventContent, EventTemplate} from "@welshman/util"
  import {makeEvent} from "@welshman/util"
  import {
    pubkey,
    publishThunk,
    signer,
    forceLoadMessagingRelayList,
    messagingRelayListsByPubkey,
  } from "@welshman/app"
  import {DM_KIND, getDmRelayUrls, getMessagingRelayHints, normalizeRelayUrls} from "@lib/budabit/dm"
  import Danger from "@assets/icons/danger-triangle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import Button from "@lib/components/Button.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ChatMessage from "@lib/budabit/components/ChatMessage.svelte"
  import ChatCompose from "@lib/budabit/components/ChatCompose.svelte"
  import ThunkToast from "@app/components/ThunkToast.svelte"
  import {userSettingsValues, deriveChat} from "@app/core/state"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {goto} from "$app/navigation"

  type Props = {
    pubkeys: string[]
    info?: Snippet
  }

  const {pubkeys, info}: Props = $props()

  const chat = deriveChat(pubkeys)
  const others = remove($pubkey!, pubkeys)
  const recipientPubkey = $derived.by(() => {
    if (others.length === 0) return $pubkey
    if (others.length === 1) return others[0]
    return undefined
  })

  const selfRelayList = $derived($messagingRelayListsByPubkey.get($pubkey!))
  const recipientRelayList = $derived(
    recipientPubkey ? $messagingRelayListsByPubkey.get(recipientPubkey) : undefined,
  )
  const selfInboxRelays = $derived(getDmRelayUrls(selfRelayList))
  const recipientInboxRelays = $derived(
    recipientPubkey ? getDmRelayUrls(recipientRelayList) : [],
  )
  const hasSelfInbox = $derived.by(() => selfInboxRelays.length > 0)
  const hasRecipientInbox = $derived.by(() => recipientInboxRelays.length > 0)
  const relayHints = $derived.by(() => getMessagingRelayHints())

  let relayChecks = $state<Record<string, boolean>>({})
  let relayHintKeys = $state<Record<string, string>>({})
  let relayLoads = $state<Record<string, boolean>>({})
  const relayTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

  const updateRecord = <T>(record: Record<string, T>, key: string, value: T) => {
    if (record[key] === value) return record
    return {...record, [key]: value}
  }

  const markRelayChecked = (key: string) => {
    const timeout = relayTimeouts.get(key)
    if (timeout) {
      clearTimeout(timeout)
      relayTimeouts.delete(key)
    }

    relayChecks = updateRecord(relayChecks, key, true)
    relayLoads = updateRecord(relayLoads, key, false)
  }

  const relayCheckPending = $derived.by(() => {
    if (!$pubkey) return true
    if (!relayChecks[$pubkey]) return true
    if (recipientPubkey && !relayChecks[recipientPubkey]) return true
    return false
  })

  const dmBlockedMessage = $derived.by(() => {
    if (!hasSelfInbox && !hasRecipientInbox) {
      return "Both you and the recipient must configure a DM inbox relay before you can send messages."
    }

    if (!hasSelfInbox) {
      return "You must configure a DM inbox relay before you can send messages."
    }

    if (!hasRecipientInbox) {
      return "Recipient must configure a DM inbox relay before they can receive messages."
    }

    return ""
  })

  const canSend = $derived.by(() => !relayCheckPending && !dmBlockedMessage)
  const composeDisabledMessage = $derived.by(() =>
    relayCheckPending ? "Loading DM inbox relays..." : dmBlockedMessage,
  )

  const showMembers = () => {
    if (others.length > 0) {
      pushModal(ProfileDetail, {pubkey: others[0]})
    }
  }

  const onSubmit = async (params: EventContent) => {
    if (!recipientPubkey || !canSend) return

    const content = params.content.trim()

    if (!content) return

    const activeSigner = signer.get()

    if (!activeSigner) {
      pushToast({theme: "error", message: "No signer available to send messages."})
      return
    }

    const encrypted = await activeSigner.nip44.encrypt(recipientPubkey, content)
    const template: EventTemplate = makeEvent(DM_KIND, {
      content: encrypted,
      tags: [["p", recipientPubkey]],
    })

    const sendRelays = normalizeRelayUrls(recipientInboxRelays)

    if (sendRelays.length === 0) {
      pushToast({
        theme: "error",
        message: "Recipient DM inbox relays are missing. Message not sent.",
      })
      return
    }

    const thunk = publishThunk({
      event: template,
      relays: sendRelays,
      delay: $userSettingsValues.send_delay,
    })

    pushToast({
      timeout: 30_000,
      children: {
        component: ThunkToast,
        props: {thunk},
      },
    })
  }

  let loading = $state(true)
  let compose: ChatCompose | undefined = $state()
  let chatCompose: HTMLElement | undefined = $state()
  let dynamicPadding: HTMLElement | undefined = $state()
  let lastToastKey = $state("")

  const elements = $derived.by(() => {
    const elements = [] as Array<{
      id: string
      type: "date" | "note"
      value: string | TrustedEvent
      showPubkey: boolean
    }>

    let previousDate
    let previousPubkey
    let previousCreatedAt = 0

    for (const event of sortBy((e: TrustedEvent) => e.created_at, $chat?.messages || [])) {
      const {id, pubkey, created_at} = event
      const date = formatTimestampAsDate(created_at)

      if (date !== previousDate) {
        elements.push({type: "date", value: date, id: date, showPubkey: false})
      }

      elements.push({
        id,
        type: "note",
        value: event,
        showPubkey: created_at - previousCreatedAt > int(2, MINUTE) || previousPubkey !== pubkey,
      })

      previousDate = date
      previousPubkey = pubkey
      previousCreatedAt = created_at
    }

    return elements.reverse()
  })

  $effect(() => {
    if (relayCheckPending) return

    const key = [hasSelfInbox, hasRecipientInbox].join(":")
    if (key === lastToastKey) return
    lastToastKey = key

    if (!hasSelfInbox && !hasRecipientInbox) {
      pushToast({
        theme: "error",
        message: "Both you and the recipient must configure a DM inbox relay before using DMs.",
        action: {
          message: "Relay settings",
          onclick: () => goto("/settings/relays"),
        },
      })
      return
    }

    if (!hasSelfInbox) {
      pushToast({
        theme: "error",
        message: "You must configure a DM inbox relay before sending messages.",
        action: {
          message: "Relay settings",
          onclick: () => goto("/settings/relays"),
        },
      })
      return
    }

    if (!hasRecipientInbox) {
      pushToast({
        theme: "error",
        message: "Recipient must have a DM inbox relay configured to receive messages.",
      })
    }
  })

  $effect(() => {
    const hintKey = relayHints.join("|")
    let nextRelayChecks = relayChecks
    let nextRelayHintKeys = relayHintKeys
    let nextRelayLoads = relayLoads

    for (const key of pubkeys) {
      if (!key) continue

      const previousHintKey = relayHintKeys[key]
      const alreadyChecked = relayChecks[key]
      const alreadyLoading = relayLoads[key]
      const hintChanged = previousHintKey !== hintKey

      if (!hintChanged && (alreadyChecked || alreadyLoading)) {
        continue
      }

      nextRelayHintKeys = updateRecord(nextRelayHintKeys, key, hintKey)
      nextRelayChecks = updateRecord(nextRelayChecks, key, false)
      nextRelayLoads = updateRecord(nextRelayLoads, key, true)

      if (!relayTimeouts.has(key)) {
        relayTimeouts.set(
          key,
          setTimeout(() => {
            markRelayChecked(key)
          }, 2500),
        )
      }

      forceLoadMessagingRelayList(key, relayHints).finally(() => {
        markRelayChecked(key)
      })
    }

    if (nextRelayChecks !== relayChecks) relayChecks = nextRelayChecks
    if (nextRelayHintKeys !== relayHintKeys) relayHintKeys = nextRelayHintKeys
    if (nextRelayLoads !== relayLoads) relayLoads = nextRelayLoads
  })

  $effect(() => {
    if ($pubkey && selfRelayList) {
      markRelayChecked($pubkey)
    }

    if (recipientPubkey && recipientRelayList) {
      markRelayChecked(recipientPubkey)
    }
  })

  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (dynamicPadding && chatCompose) {
        dynamicPadding.style.minHeight = `${chatCompose.offsetHeight}px`
      }
    })

    observer.observe(chatCompose!)
    observer.observe(dynamicPadding!)

    return () => {
      observer.unobserve(chatCompose!)
      observer.unobserve(dynamicPadding!)
    }
  })

  setTimeout(() => {
    loading = false
  }, 5000)
</script>

<PageBar>
  {#snippet title()}
    <Button class="flex flex-col gap-1 sm:flex-row sm:gap-2" onclick={showMembers}>
      {#if others.length === 0}
        <div class="row-2">
          <ProfileCircle pubkey={$pubkey!} size={5} />
          <ProfileName pubkey={$pubkey!} />
        </div>
      {:else}
        <div class="row-2">
          <ProfileCircle pubkey={others[0]} size={5} />
          <ProfileName pubkey={others[0]} />
        </div>
      {/if}
    </Button>
  {/snippet}
  {#snippet action()}
    {#if !canSend && !relayCheckPending}
      <div class="row-2 badge badge-error badge-lg tooltip tooltip-left cursor-pointer" data-tip={dmBlockedMessage}>
        <Icon icon={Danger} />
        DM blocked
      </div>
    {/if}
  {/snippet}
</PageBar>

<PageContent class="flex flex-col-reverse gap-2 pt-4">
  <div bind:this={dynamicPadding}></div>
  {#if relayCheckPending}
    <div class="py-12">
      <div class="card2 col-2 m-auto max-w-md items-center text-center">
        <p class="row-2 text-lg">
          <Spinner />
          Loading DM inbox relays...
        </p>
        <p>We’re checking relay settings for both participants.</p>
      </div>
    </div>
  {:else if !canSend}
    <div class="py-12">
      <div class="card2 col-2 m-auto max-w-md items-center text-center">
        <p class="row-2 text-lg text-error">
          <Icon icon={Danger} />
          DM inbox relay required.
          </p>
          {#if relayCheckPending}
            <p>Checking DM inbox relays...</p>
          {:else}
            <p>
              {#if !hasSelfInbox && !hasRecipientInbox}
                You must <Link class="link" href="/settings/relays">configure</Link> a DM inbox relay,
                and the recipient must do the same.
              {:else if !hasSelfInbox}
                You must <Link class="link" href="/settings/relays">configure</Link> a DM inbox relay
                before you can send messages.
              {:else if !hasRecipientInbox}
                Recipient must configure a DM inbox relay before they can receive messages.
              {:else}
                {dmBlockedMessage}
              {/if}
            </p>
          {/if}
        </div>
      </div>
    {/if}
  {#each elements as {type, id, value, showPubkey} (id)}
    {#if type === "date"}
      <Divider>{value}</Divider>
    {:else}
      <ChatMessage event={$state.snapshot(value as TrustedEvent)} {showPubkey} />
    {/if}
  {/each}
  <p class="m-auto flex h-10 max-w-sm flex-col items-center justify-center gap-4 py-20 text-center">
    <Spinner {loading}>
      {#if loading}
        Looking for messages...
      {:else}
        End of message history
      {/if}
    </Spinner>
    {@render info?.()}
  </p>
</PageContent>

<div class="chat__compose bg-base-200" bind:this={chatCompose}>
  <ChatCompose
    bind:this={compose}
    {onSubmit}
    disabled={!canSend}
    disabledMessage={composeDisabledMessage} />
</div>
