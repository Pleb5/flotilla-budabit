<style>
  a,
  button {
    padding: 12px 16px;
    display: flex;
    border-radius: var(--rounded-btn, 0.5rem);
    cursor: pointer;
    animation: nav-button-pop 200ms ease-out;
    transition-property: all;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 150ms;
  }

  a:active:hover,
  a:active:focus,
  button:active:hover,
  button:active:focus {
    animation: button-pop 0s ease-out;
    transform: scale(var(--btn-focus-scale, 0.97));
  }
</style>

<script lang="ts">
  import NotificationDot from "@lib/components/NotificationDot.svelte"
  import {page} from "$app/stores"

  const {children, href = "", notification = false, replaceState = false, ...restProps} = $props()

  const active = $derived($page.url.pathname === href.split(/[?#]/)[0])
</script>

{#if href}
  <a
    {href}
    {...restProps}
    data-sveltekit-replacestate={replaceState}
    class="{restProps.class} relative flex items-center gap-3 text-left transition-all hover:bg-base-100 hover:text-base-content"
    class:text-base-content={active}
    class:bg-base-100={active}>
    {@render children?.()}
    {#if !active && notification}
      <NotificationDot class="ml-auto" />
    {/if}
  </a>
{:else}
  <button
    {...restProps}
    class="{restProps.class} relative flex w-full items-center gap-3 text-left transition-all hover:bg-base-100 hover:text-base-content"
    class:text-base-content={active}
    class:bg-base-100={active}>
    {@render children?.()}
    {#if !active && notification}
      <NotificationDot class="ml-auto" />
    {/if}
  </button>
{/if}
