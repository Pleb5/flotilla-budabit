<style>
  /* Contain scrolling while the fixed-height dialog is present, including its outro. */
  :global(html:has(.fixed-height-dialog)),
  :global(body:has(.fixed-height-dialog)) {
    overscroll-behavior-y: none;
  }

  .fixed-height-dialog-layer {
    overflow: hidden;
    overscroll-behavior-y: none;
  }

  .fixed-height-dialog {
    display: flex;
    min-height: 0;
    height: min(44rem, 90dvh, calc(100dvh - max(1rem, var(--sait))));
    flex-direction: column;
    overflow: hidden;
    padding-top: 1rem;
    padding-bottom: max(1rem, var(--saib));
    padding-left: max(1rem, var(--sail));
    padding-right: max(1rem, var(--sair));
  }

  .fixed-height-dialog > :global([data-modal-content]) {
    display: flex;
    min-height: 0;
    flex: 1;
  }

  @media (min-width: 640px) {
    .fixed-height-dialog {
      padding-top: 1.5rem;
      padding-bottom: 1.5rem;
      padding-left: max(1.5rem, var(--sail));
      padding-right: max(1.5rem, var(--sair));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .fixed-height-dialog {
      transition: none;
    }
  }
</style>

<script lang="ts">
  import cx from "classnames"
  import {noop} from "@welshman/lib"
  import {fade, fly} from "@lib/transition"
  import {MediaQuery} from "svelte/reactivity"

  interface Props {
    onClose?: any
    fullscreen?: boolean
    fixedHeight?: boolean
    ariaLabel?: string
    children?: import("svelte").Snippet
  }

  const {
    onClose = noop,
    fullscreen = false,
    fixedHeight = false,
    ariaLabel,
    children,
  }: Props = $props()

  const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)", false)

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
        "max-h-[90vh] scroll-container overflow-auto": !fullscreen && !fixedHeight,
        "fixed-height-dialog": fixedHeight,
      },
    ),
  )
</script>

<div class="center fixed inset-0 z-modal" class:fixed-height-dialog-layer={fixedHeight}>
  <button
    aria-label="Close dialog"
    class="absolute inset-0 cursor-pointer bg-[#ccc] opacity-75 dark:bg-black"
    transition:fade={{duration: reducedMotion.current ? 0 : 300}}
    onclick={onClose}>
  </button>
  <div class={wrapperClass}>
    <div
      class={innerClass}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabindex="-1"
      transition:fly={{duration: reducedMotion.current ? 0 : 300}}>
      {@render children?.()}
    </div>
  </div>
</div>
