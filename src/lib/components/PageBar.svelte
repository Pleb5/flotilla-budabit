<script lang="ts">
  import type {Snippet} from "svelte"
  import TopMenuWidgets from "@app/components/TopMenuWidgets.svelte"

  interface Props {
    icon?: Snippet
    title?: Snippet
    action?: Snippet
    showTopMenuWidgets?: boolean
    [key: string]: any
  }

  const {...props}: Props = $props()
</script>

<div data-component="PageBar" class="cw top-sai fixed z-nav p-2 {props.class}">
  <div
    class="flex min-h-12 items-center justify-between gap-4 rounded-xl bg-base-100 px-4 shadow-md">
    <div
      class="scrollbar-hide flex min-w-0 flex-1 items-center gap-4 overflow-x-auto overscroll-x-contain whitespace-nowrap">
      {@render props.icon?.()}
      {@render props.title?.()}
    </div>
    <div class="flex shrink-0 items-center gap-2">
      {#if props.showTopMenuWidgets !== false}
        <TopMenuWidgets />
      {/if}
      {@render props.action?.()}
    </div>
  </div>
</div>
