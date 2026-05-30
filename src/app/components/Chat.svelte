<script lang="ts">
  import type {Snippet} from "svelte"
  import {onMount} from "svelte"
  import {int, sortBy, remove, formatTimestampAsDate, MINUTE} from "@welshman/lib"
  import type {TrustedEvent, EventContent, EventTemplate, Filter} from "@welshman/util"
  import {makeEvent} from "@welshman/util"
  import {load} from "@welshman/net"
  import {
    pubkey,
    publishThunk,
    signer,
    forceLoadMessagingRelayList,
    messagingRelayListsByPubkey,
  } from "@welshman/app"
  import {DM_KIND, getDmPublishRelays, getDmRelayUrls, getMessagingRelayHints} from "@app/core/dm"
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
  import ChatMessage from "@app/components/ChatMessage.svelte"
  import ChatCompose from "@app/components/ChatCompose.svelte"
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

  const INITIAL_MESSAGE_COUNT = 120
  const MESSAGE_BATCH_SIZE = 120
  const INITIAL_THREAD_LOAD_TIMEOUT = 3000

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
  const recipientInboxRelays = $derived(recipientPubkey ? getDmRelayUrls(recipientRelayList) : [])
  const hasSelfInbox = $derived.by(() => selfInboxRelays.length > 0)
  const hasRecipientInbox = $derived.by(() => recipientInboxRelays.length > 0)
  const relayHints = $derived.by(() => getMessagingRelayHints())

  let relayChecks = $state<Record<string, boolean>>({})
  let relayHintKeys = $state<Record<string, string>>({})
  let relayLoads = $state<Record<string, boolean>>({})
  const relayTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

  const updateRecord = <T,>(record: Record<string, T>, key: string, value: T) => {
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

    const sendRelays = getDmPublishRelays(selfInboxRelays, recipientInboxRelays)

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
  let visibleMessageCount = $state(INITIAL_MESSAGE_COUNT)
  let olderMessagesLoading = $state(false)
  let olderMessagesExhausted = $state(false)
  let initialThreadLoadKey = ""
  let initialThreadLoadId = 0
  let initialThreadLoading = $state(false)
  let activeChatId = $state("")

  const finishInitialThreadLoad = (loadId: number) => {
    if (loadId === initialThreadLoadId) {
      initialThreadLoading = false
    }
  }

  const sortedMessages = $derived.by(() =>
    sortBy((e: TrustedEvent) => e.created_at, $chat?.messages || []),
  )
  const visibleMessages = $derived.by(() =>
    sortedMessages.slice(Math.max(0, sortedMessages.length - visibleMessageCount)),
  )
  const hasOlderMessages = $derived(sortedMessages.length > visibleMessageCount)
  const canLoadOlderMessages = $derived(
    hasOlderMessages || (sortedMessages.length > 0 && !olderMessagesExhausted),
  )

  const showOlderLoadedMessages = () => {
    visibleMessageCount = Math.min(visibleMessageCount + MESSAGE_BATCH_SIZE, sortedMessages.length)
  }

  const makeConversationFilters = (
    selfPubkey: string,
    recipientPubkey: string,
    extra: Filter = {},
  ): Filter[] =>
    recipientPubkey === selfPubkey
      ? [{kinds: [DM_KIND], authors: [selfPubkey], "#p": [selfPubkey], ...extra}]
      : [
          {kinds: [DM_KIND], authors: [recipientPubkey], "#p": [selfPubkey], ...extra},
          {kinds: [DM_KIND], authors: [selfPubkey], "#p": [recipientPubkey], ...extra},
        ]

  const loadOlderMessages = async () => {
    if (olderMessagesLoading) return
    if (hasOlderMessages) {
      showOlderLoadedMessages()
      return
    }

    const selfPubkey = $pubkey
    const oldestMessage = sortedMessages[0]
    if (!selfPubkey || !recipientPubkey || !oldestMessage) return

    const until = oldestMessage.created_at - 1
    const relays = getDmPublishRelays(selfInboxRelays, recipientInboxRelays)
    if (relays.length === 0) {
      olderMessagesExhausted = true
      return
    }

    const filters = makeConversationFilters(selfPubkey, recipientPubkey, {
      until,
      limit: MESSAGE_BATCH_SIZE,
    })

    olderMessagesLoading = true

    try {
      const events = await load({relays, filters})
      visibleMessageCount += MESSAGE_BATCH_SIZE
      olderMessagesExhausted = events.length === 0
    } catch {
      pushToast({theme: "error", message: "Failed to load older messages."})
    } finally {
      olderMessagesLoading = false
    }
  }

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

    for (const event of visibleMessages) {
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
    const chatId = $chat?.id || ""
    if (chatId !== activeChatId) {
      activeChatId = chatId
      visibleMessageCount = INITIAL_MESSAGE_COUNT
      olderMessagesLoading = false
      olderMessagesExhausted = false
      initialThreadLoadKey = ""
      initialThreadLoadId += 1
      initialThreadLoading = false
    }
  })

  $effect(() => {
    if (relayCheckPending) return

    const selfPubkey = $pubkey
    const recipient = recipientPubkey
    if (!selfPubkey || !recipient) return

    const relays = getDmPublishRelays(selfInboxRelays, recipientInboxRelays)
    if (relays.length === 0) return

    const key = [selfPubkey, recipient, relays.join("|")].join(":")
    if (key === initialThreadLoadKey) return

    initialThreadLoadKey = key
    const loadId = ++initialThreadLoadId
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
      finishInitialThreadLoad(loadId)
    }, INITIAL_THREAD_LOAD_TIMEOUT)

    initialThreadLoading = true

    load({
      relays,
      filters: makeConversationFilters(selfPubkey, recipient, {limit: MESSAGE_BATCH_SIZE}),
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout)
        finishInitialThreadLoad(loadId)
      })
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
  }, INITIAL_THREAD_LOAD_TIMEOUT)
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
      <div
        class="row-2 badge badge-error badge-lg tooltip tooltip-left cursor-pointer"
        data-tip={dmBlockedMessage}>
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
              You must <Link class="link" href="/settings/relays">configure</Link> a DM inbox relay, and
              the recipient must do the same.
            {:else if !hasSelfInbox}
              You must <Link class="link" href="/settings/relays">configure</Link> a DM inbox relay before
              you can send messages.
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
  {#each elements as { type, id, value, showPubkey } (id)}
    {#if type === "date"}
      <Divider>{value}</Divider>
    {:else}
      <ChatMessage event={value as TrustedEvent} {showPubkey} />
    {/if}
  {/each}
  <p class="m-auto flex h-10 max-w-sm flex-col items-center justify-center gap-4 py-20 text-center">
    {#if canLoadOlderMessages}
      {#if olderMessagesLoading}
        <Spinner loading>Loading older messages...</Spinner>
      {:else}
        <Button class="btn btn-neutral btn-sm" onclick={loadOlderMessages}
          >Load older messages</Button>
      {/if}
      <span class="text-xs opacity-70">
        Showing {visibleMessages.length} of {sortedMessages.length} loaded messages
      </span>
    {:else}
      <Spinner loading={loading || initialThreadLoading}>
        {#if loading || initialThreadLoading}
          Looking for messages...
        {:else}
          End of message history
        {/if}
      </Spinner>
    {/if}
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
