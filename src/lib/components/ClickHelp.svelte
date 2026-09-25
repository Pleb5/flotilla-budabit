<script lang="ts">
  import {Info, X} from "@lucide/svelte"
  import InlinePopover from "./InlinePopover.svelte"
  import {onMount, tick} from "svelte"

  const {label, text}: {label: string; text: string} = $props()
  const id = $props.id()
  let open = $state(false)
  let trigger: HTMLButtonElement
  const close = () => {
    open = false
    trigger?.focus({preventScroll: true})
  }
  $effect(() => {
    if (open) void tick().then(() => document.getElementById(id)?.focus({preventScroll: true}))
  })
  onMount(() => {
    const escape = (event: KeyboardEvent) => {
      if (open && event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
    }
    window.addEventListener("keydown", escape, true)
    return () => window.removeEventListener("keydown", escape, true)
  })
</script>

<span class="inline-flex max-w-full items-center" data-stop-tap>
  <button
    bind:this={trigger}
    type="button"
    class="inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    aria-expanded={open}
    aria-controls={id}
    aria-haspopup="dialog"
    onclick={event => {
      event.stopPropagation()
      open = !open
    }}>
    {label}<Info size={13} class="shrink-0 opacity-60" />
  </button>
  {#if open}
    <InlinePopover onClose={close} widthClass="w-72" layerClass="z-modal-feature">
      <div {id} role="dialog" tabindex="-1" aria-label={label} class="text-sm text-base-content">
        <div class="mb-1 flex items-center justify-between gap-3">
          <strong>{label}</strong>
          <button
            type="button"
            class="center size-10 shrink-0 rounded-full hover:bg-base-200"
            aria-label="Close explanation"
            onclick={close}><X size={16} /></button>
        </div>
        <p class="whitespace-pre-line leading-relaxed text-base-content/75">{text}</p>
      </div>
    </InlinePopover>
  {/if}
</span>
