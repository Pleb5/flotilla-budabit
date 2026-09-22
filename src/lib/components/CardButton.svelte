<script lang="ts">
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  interface Props {
    icon?: import("svelte").Snippet
    title?: import("svelte").Snippet
    info?: import("svelte").Snippet
    pending?: boolean
    compact?: boolean
    [key: string]: any
  }

  const {pending = false, compact = false, ...props}: Props = $props()
</script>

<div
  class="btn flex h-[unset] w-full flex-nowrap {compact ? 'py-2' : 'py-4'} text-left {pending
    ? 'cursor-wait'
    : ''} {props.class}">
  <div class="flex flex-grow flex-row items-start {compact ? 'gap-3' : 'gap-4'}">
    <div
      class="flex {compact ? 'h-10 w-10' : 'h-14 w-12'} flex-shrink-0 items-center justify-center">
      {@render props.icon?.()}
    </div>
    <div class="flex flex-col gap-1">
      <p class="text-bold {compact ? 'text-base' : 'text-lg'}">
        {@render props.title?.()}
      </p>
      <p class={compact ? "text-xs" : "text-sm"}>
        {@render props.info?.()}
      </p>
    </div>
  </div>
  {#if pending}
    <div class="flex {compact ? 'h-10 w-10' : 'h-14 w-14'} shrink-0 items-center justify-end">
      <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
      <span class="sr-only">Opening...</span>
    </div>
  {:else}
    <div class="hidden {compact ? 'h-10 w-10' : 'h-14 w-14'} items-center justify-end sm:flex">
      <Icon size={compact ? 5 : 7} icon={AltArrowRight} />
    </div>
  {/if}
</div>
