<style>
  /* Header gaps, controls and the backdrop must never chain into page refresh.
     Keep the lock through the outro (and stacked dialogs), then release it automatically. */
  :global(html:has(.swipe-dialog)),
  :global(body:has(.swipe-dialog)) {
    overscroll-behavior-y: none;
  }

  .swipe-dialog-layer {
    overflow: hidden;
    overscroll-behavior-y: none;
  }

  .swipe-dialog {
    --swipe-padding-left: max(1rem, var(--sail));
    --swipe-padding-right: max(1rem, var(--sair));
    display: flex;
    min-height: 0;
    height: min(44rem, 90dvh, calc(100dvh - max(1rem, var(--sait))));
    flex-direction: column;
    overflow: hidden;
    padding-top: 0;
    padding-bottom: max(1rem, var(--saib));
    padding-left: var(--swipe-padding-left);
    padding-right: var(--swipe-padding-right);
    will-change: translate;
    transition: translate 180ms ease-out;
  }

  .swipe-dialog:global([data-swipe-dragging]) {
    transition: none;
  }

  .swipe-dialog > :global([data-modal-content]) {
    display: flex;
    min-height: 0;
    flex: 1;
  }

  .swipe-dialog :global([data-swipe-dismiss-handle="full-width"]) {
    margin-left: calc(-1 * var(--swipe-padding-left));
    margin-right: calc(-1 * var(--swipe-padding-right));
    padding-left: var(--swipe-padding-left);
    padding-right: var(--swipe-padding-right);
  }

  .swipe-dialog :global([data-swipe-dismiss-handle]) {
    /* Decided before pointerdown: prevent the browser stealing even a fast diagonal pull.
       Controls sit outside this surface so they retain native touch behavior. */
    touch-action: pinch-zoom;
    user-select: none;
    -webkit-user-select: none;
  }

  @media (min-width: 640px) {
    .swipe-dialog {
      --swipe-padding-left: max(1.5rem, var(--sail));
      --swipe-padding-right: max(1.5rem, var(--sair));
      padding-bottom: 1.5rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .swipe-dialog {
      transition: none;
    }
  }
</style>

<script lang="ts">
  import cx from "classnames"
  import {noop} from "@welshman/lib"
  import {fade, fly} from "@lib/transition"
  import {MediaQuery} from "svelte/reactivity"
  import {swipeDismiss} from "@lib/swipe-dismiss"

  interface Props {
    onClose?: any
    fullscreen?: boolean
    swipeToDismiss?: boolean
    ariaLabel?: string
    children?: import("svelte").Snippet
  }

  const {
    onClose = noop,
    fullscreen = false,
    swipeToDismiss = false,
    ariaLabel,
    children,
  }: Props = $props()

  const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)", false)
  let panel: HTMLDivElement
  const onDrag = (distance: number, active: boolean) => {
    // The action calls this once per frame. Keep finger tracking off Svelte's update path,
    // and only animate when returning to rest, never while following the finger.
    panel.toggleAttribute("data-swipe-dragging", active)
    panel.style.translate = `0 ${distance}px`
  }
  const panelTransition = (node: HTMLElement) =>
    fly(node, {
      duration: reducedMotion.current ? 0 : swipeToDismiss ? 250 : 300,
      y: swipeToDismiss ? window.innerHeight - node.getBoundingClientRect().top : 20,
    })

  const wrapperClass = $derived(
    cx("absolute inset-0 flex sm:relative pointer-events-none", {
      "items-center justify-center": fullscreen,
      "items-end sm:w-[520px] sm:items-center": !fullscreen,
    }),
  )

  const innerClass = $derived(
    cx(
      "relative text-base-content text-base-content flex-grow pointer-events-auto",
      "px-4 py-6 rounded-t-box sm:p-6 sm:rounded-box sm:mt-0",
      {
        "bg-alt shadow-m": !fullscreen,
        "max-h-[90vh] scroll-container overflow-auto": !fullscreen && !swipeToDismiss,
        "swipe-dialog": swipeToDismiss,
      },
    ),
  )
</script>

<div class="center fixed inset-0 z-modal" class:swipe-dialog-layer={swipeToDismiss}>
  <button
    aria-label="Close dialog"
    class="absolute inset-0 cursor-pointer bg-[#ccc] opacity-75 dark:bg-black"
    transition:fade={{duration: reducedMotion.current ? 0 : swipeToDismiss ? 250 : 300}}
    onclick={onClose}>
  </button>
  <div class={wrapperClass}>
    <div
      bind:this={panel}
      class={innerClass}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabindex="-1"
      style:translate={swipeToDismiss ? "0 0" : undefined}
      use:swipeDismiss={{enabled: swipeToDismiss, onDrag, onDismiss: onClose}}
      transition:panelTransition>
      {#if swipeToDismiss}
        <div
          data-swipe-dismiss-handle="full-width"
          data-testid="modal-drag-handle"
          class="flex h-11 shrink-0 items-center justify-center"
          aria-hidden="true">
          <span class="h-1 w-10 rounded-full bg-base-content/30"></span>
        </div>
      {/if}
      {@render children?.()}
    </div>
  </div>
</div>
