<script lang="ts">
  import {noop} from "@welshman/lib"
  import {fade, fly} from "@lib/transition"
  import {onMount} from "svelte"

  interface Props {
    onClose?: any
    fullscreen?: boolean
    children?: import("svelte").Snippet
  }

  const {onClose = noop, fullscreen = false, children}: Props = $props()

  // Build container classes without leaking boolean values like "false" into the class attribute
  const containerClass = $derived.by(() =>
    [
      "scroll-container",
      "relative",
      fullscreen
        ? ""
        : "card2 bg-alt max-h-[90vh] w-[90vw] overflow-auto text-base-content sm:w-[520px] shadow-xl",
    ]
      .filter(Boolean)
      .join(" "),
  )

  // Close on Escape key for better a11y
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
</script>

<div class="center fixed inset-0 z-modal" role="dialog" aria-modal="true">
  <button
    aria-label="Close dialog"
    class="absolute inset-0 cursor-pointer bg-[#ccc] opacity-75 dark:bg-black"
    transition:fade={{duration: 300}}
    onclick={onClose}>
  </button>
  <div class={containerClass} transition:fly={{duration: 300}}>
    {@render children?.()}
  </div>
</div>
