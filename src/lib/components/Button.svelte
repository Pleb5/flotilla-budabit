<script lang="ts">
  import type {Snippet} from "svelte"

  let {
    onclick,
    type = "button",
    ref = $bindable(null),
    children,
    ...restProps
  }: {
    children?: Snippet // Changed from required to optional
    onclick?: (event: Event) => any
    type?: "button" | "submit"
    class?: string
    style?: string
    disabled?: boolean
    "data-tip"?: string
    ref?: any
  } = $props()

  const className = $derived(`text-left ${restProps.class}`)

  const onClick = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()

    onclick?.(e)
  }
</script>

{#if type === "submit"}
  <button {...restProps} {type} class={className} bind:this={ref}>
    {#if children}
      {@render children()}
    {/if}
  </button>
{:else}
  <button
    {...restProps}
    onclick={onClick}
    type={type as "button" | "submit"}
    class={className}
    bind:this={ref}>
    {#if children}
      {@render children()}
    {/if}
  </button>
{/if}
