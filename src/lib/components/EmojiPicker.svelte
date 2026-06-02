<style>
  @media (max-width: 450px) {
    emoji-picker {
      max-width: 100%;
      --num-columns: 6;
      --category-emoji-size: 1.125rem;
    }
  }
</style>

<script lang="ts">
  import "emoji-picker-element"
  import type {EmojiClickEventDetail, NativeEmoji} from "emoji-picker-element/shared"
  import {onMount} from "svelte"

  interface Props {
    onClick: (emoji: NativeEmoji) => void
  }

  const {onClick}: Props = $props()

  let element: Element | undefined = $state()

  const isNativeEmoji = (emoji: EmojiClickEventDetail["emoji"]): emoji is NativeEmoji =>
    "unicode" in emoji && typeof emoji.unicode === "string"

  const onEmojiClick = (event: Event) => {
    const detail = (event as CustomEvent<EmojiClickEventDetail>).detail

    if (!detail || !isNativeEmoji(detail.emoji)) return

    onClick({...detail.emoji, unicode: detail.unicode || detail.emoji.unicode})
  }

  onMount(() => {
    element?.addEventListener("emoji-click", onEmojiClick)

    return () => {
      element?.removeEventListener("emoji-click", onEmojiClick)
    }
  })
</script>

<emoji-picker bind:this={element} class="m-auto"></emoji-picker>
