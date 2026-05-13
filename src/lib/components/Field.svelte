<script lang="ts">
  import type {Snippet} from "svelte"

  interface Props {
    label?: Snippet
    secondary?: Snippet
    input?: Snippet
    info?: Snippet
    error?: string
    [key: string]: any
  }

  const {label, secondary, input, info, error, ...props}: Props = $props()
</script>

<div class="flex flex-col gap-2 {props.class}">
  <div class="flex items-center justify-between">
    {#if label}
      <label class="flex items-center gap-2 font-bold">
        {@render label()}
      </label>
    {/if}
    {#if secondary}
      <label class="flex items-center gap-2">
        {@render secondary()}
      </label>
    {/if}
  </div>
  {@render input?.()}
  {#if info}
    <p class="text-sm opacity-50">
      {@render info()}
    </p>
  {/if}
  {#if error}
    <p class="text-sm font-medium text-error">{error}</p>
  {/if}
</div>
