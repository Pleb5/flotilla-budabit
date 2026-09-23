<script lang="ts">
  import {onMount} from "svelte"
  import type {Chat} from "@app/core/state"
  import ChatItem from "./ChatItem.svelte"

  const {chat, class: className = ""}: {chat: Chat; class?: string} = $props()
  let element: HTMLDivElement
  let visible = $state(false)
  let height = $state(92)

  onMount(() => {
    const intersection = new IntersectionObserver(
      entries => {
        visible = entries.some(entry => entry.isIntersecting)
      },
      {rootMargin: "200px"},
    )
    const resize = new ResizeObserver(entries => {
      if (visible && entries[0].contentRect.height > 0) height = entries[0].contentRect.height
    })
    intersection.observe(element)
    resize.observe(element)
    return () => {
      intersection.disconnect()
      resize.disconnect()
    }
  })
</script>

<div bind:this={element} style:min-height={`${height}px`}>
  {#if visible}
    <ChatItem
      id={chat.id}
      pubkeys={chat.pubkeys}
      latestMessage={chat.latestMessage}
      class={className} />
  {/if}
</div>
