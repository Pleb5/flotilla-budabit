<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {remove, formatTimestamp} from "@welshman/lib"
  import type {TrustedEvent} from "@welshman/util"
  import {pubkey, forceLoadMessagingRelayList, getPlaintext} from "@welshman/app"
  import {ensureDmPlaintext, getMessagingRelayHints} from "@lib/budabit/dm"
  import {fade} from "@lib/transition"
  import Link from "@lib/components/Link.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import {makeChatPath} from "@app/util/routes"
  import {notifications} from "@app/util/notifications"

  interface Props {
    id: string
    pubkeys: string[]
    messages: TrustedEvent[]
    [key: string]: any
  }

  const {...props}: Props = $props()

  const others = remove($pubkey!, props.pubkeys)
  const active = $derived($page.params.chat === props.id)
  const path = makeChatPath(props.pubkeys)
  const latestMessage = $derived.by(() => {
    if (!props.messages?.length) return undefined
    return props.messages.reduce((latest, current) =>
      current.created_at > latest.created_at ? current : latest,
    )
  })

  let previewText = $state("")
  let previewDecrypting = $state(false)
  let previewDecryptFailed = $state(false)

  $effect(() => {
    let cancelled = false
    const message = latestMessage

    if (!message) {
      previewText = ""
      previewDecrypting = false
      previewDecryptFailed = false
      return
    }

    const existing = getPlaintext(message)
    previewText = existing ?? ""
    previewDecrypting = false
    previewDecryptFailed = false

    if ($pubkey && existing === undefined && message.content) {
      previewDecrypting = true
      ensureDmPlaintext(message, $pubkey)
        .then(result => {
          if (cancelled) return
          if (latestMessage !== message) return
          if (result !== undefined) {
            previewText = result
            previewDecryptFailed = false
          } else {
            previewDecryptFailed = true
          }
        })
        .catch(() => {
          if (cancelled) return
          previewDecryptFailed = true
        })
        .finally(() => {
          if (cancelled) return
          previewDecrypting = false
        })
    }

    return () => {
      cancelled = true
    }
  })

  onMount(() => {
    for (const pk of others) {
      forceLoadMessagingRelayList(pk, getMessagingRelayHints())
    }
  })
</script>

<Link class="flex flex-col justify-start gap-1" href={makeChatPath(props.pubkeys)}>
  <div
    class="cursor-pointer border-t border-solid border-base-100 px-6 py-2 transition-colors hover:bg-base-100 {props.class}"
    class:bg-base-100={active}>
    <div class="flex flex-col justify-start gap-1">
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          {#if others.length === 0}
            <ProfileCircle pubkey={$pubkey!} size={5} />
            Note to self
          {:else if others.length === 1}
            <ProfileCircle pubkey={others[0]} size={5} />
            <ProfileName pubkey={others[0]} />
          {:else}
            <ProfileCircle pubkey={others[0]} size={5} />
            <p class="overflow-hidden text-ellipsis whitespace-nowrap">Group chat (read-only)</p>
          {/if}
        </div>
        {#if !active && $notifications.has(path)}
          <div class="h-2 w-2 rounded-full bg-primary" transition:fade></div>
        {/if}
      </div>
      <p class="overflow-hidden text-ellipsis whitespace-nowrap text-sm">
        <span class="opacity-70">
          {#if latestMessage?.pubkey === $pubkey}
            You:
          {/if}
        </span>
        {#if previewDecrypting}
          <span class="inline-block h-3 w-32 animate-pulse rounded bg-base-200 align-middle"></span>
        {:else if previewDecryptFailed}
          <span class="text-xs opacity-60">Encrypted message</span>
        {:else}
          {previewText}
        {/if}
      </p>
      {#if latestMessage}
        <p class="text-xs opacity-70">{formatTimestamp(latestMessage.created_at)}</p>
      {/if}
    </div>
  </div>
</Link>
