<style>
  .presentation-controls {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.4rem;
  }
  .presentation-controls strong {
    margin-right: auto;
  }
  .expanded,
  .presentation-surface:fullscreen {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    background: var(--color-base-100, #151c23);
    color: var(--color-base-content, #f5f5f4);
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
    margin: 0;
    border: 0;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    max-width: none;
    max-height: none;
  }
  .expanded .presentation-surface {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .expanded .presentation-content {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .expanded .presentation-content :global([data-widget-visibility="visible"]) {
    height: 100% !important;
    min-height: 0 !important;
  }
</style>

<script lang="ts">
  import {onMount, tick, type Snippet} from "svelte"

  let {title, enabled, children}: {title: string; enabled: boolean; children: Snippet} = $props()
  let surface = $state<HTMLDivElement>()
  let overlay = $state<HTMLDivElement>()
  let expanded = $state(false)
  let nativeFullscreen = $state(false)
  let notice = $state("")
  let opener: HTMLElement | null = null

  async function restoreFocus() {
    await tick()
    if (opener?.isConnected) opener.focus()
    else overlay?.querySelector("button")?.focus()
  }

  async function enlarge() {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    expanded = true
    await tick()
    // The top layer escapes transformed/stacking ancestors without moving or
    // remounting the iframe. CSS z-index alone cannot cover the page navbar.
    overlay?.showPopover?.()
    overlay?.querySelector("button")?.focus()
  }

  async function close() {
    if (document.fullscreenElement && surface?.contains(document.fullscreenElement)) {
      await document.exitFullscreen().catch(() => {})
    }
    if (overlay?.hidePopover && overlay.matches(":popover-open")) overlay.hidePopover()
    expanded = false
    void restoreFocus()
  }

  async function fullscreen() {
    if (!expanded) await enlarge()
    notice = ""
    try {
      if (!surface?.requestFullscreen) throw new Error("Unavailable")
      await surface.requestFullscreen()
    } catch {
      notice = "Browser fullscreen is unavailable. The enlarged view is still open."
    }
  }

  $effect(() => {
    if (!enabled && expanded) void close()
  })

  $effect(() => {
    if (!expanded) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  })

  onMount(() => {
    function changed() {
      const wasNative = nativeFullscreen
      // A nested call/player can become fullscreen inside an already-fullscreen
      // host surface. Do not hide its ancestor popover or remount its iframe.
      nativeFullscreen = Boolean(
        document.fullscreenElement && surface?.contains(document.fullscreenElement),
      )
      if (wasNative && !nativeFullscreen) {
        if (overlay?.hidePopover && overlay.matches(":popover-open")) overlay.hidePopover()
        expanded = false
        void restoreFocus()
      }
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && expanded && !nativeFullscreen) void close()
    }
    document.addEventListener("fullscreenchange", changed)
    window.addEventListener("keydown", keydown)
    return () => {
      document.removeEventListener("fullscreenchange", changed)
      window.removeEventListener("keydown", keydown)
    }
  })
</script>

<div
  bind:this={overlay}
  popover={expanded ? "manual" : undefined}
  class:expanded
  class="widget-presentation">
  <div bind:this={surface} class="presentation-surface">
    {#if enabled}
      <div class="presentation-controls">
        {#if expanded}
          <strong>{title}</strong>
          <button class="btn btn-sm" onclick={() => void close()}>Back to community</button>
        {:else}
          <button class="btn btn-sm" aria-label={`Enlarge ${title}`} onclick={enlarge}
            >Enlarge</button>
        {/if}
        {#if !nativeFullscreen}
          <button
            class="btn btn-sm"
            aria-label={`Full screen ${title}`}
            onclick={() => void fullscreen()}>Full screen</button>
        {/if}
        {#if notice}<span role="status">{notice}</span>{/if}
      </div>
    {/if}
    <div class="presentation-content">{@render children()}</div>
  </div>
</div>
