<script lang="ts">
  import {page} from "$app/stores"
  import Button from "@lib/components/Button.svelte"
  import NotificationDot from "@lib/components/NotificationDot.svelte"
  import {isMobile} from "@lib/html"

  const {
    children,
    onclick = undefined,
    title = "",
    href = "",
    prefix = "",
    compact = false,
    notification = false,
    ...restProps
  } = $props()

  const active = $derived($page.url?.pathname?.startsWith(prefix || href || "bogus"))
  const tooltipEnabled = $derived(Boolean(title) && !compact && !isMobile)
  const wrapperClass = $derived(
    compact
      ? "relative z-nav-item flex h-14 min-w-0 flex-1 items-center justify-center"
      : "relative z-nav-item flex h-14 w-14 items-center justify-center",
  )
  const avatarClass = $derived(
    `avatar cursor-pointer rounded-full p-2 transition-colors hover:bg-base-300 ${compact ? "flex h-10 w-10 items-center justify-center p-1.5" : ""} ${restProps.class || ""}`,
  )
</script>

{#if href}
  <a {href} class={wrapperClass} aria-label={title || undefined}>
    <div
      class={avatarClass}
      class:bg-base-300={active}
      class:tooltip={tooltipEnabled}
      data-tip={tooltipEnabled ? title : undefined}>
      {@render children?.()}
      {#if !active && notification}
        <NotificationDot class="absolute right-1 top-1" />
      {/if}
    </div>
  </a>
{:else}
  <Button {onclick} class={wrapperClass} aria-label={title || undefined}>
    <div
      class={avatarClass}
      class:bg-base-300={active}
      class:tooltip={tooltipEnabled}
      data-tip={tooltipEnabled ? title : undefined}>
      {@render children?.()}
      {#if !active && notification}
        <NotificationDot class="absolute right-1 top-1" />
      {/if}
    </div>
  </Button>
{/if}
