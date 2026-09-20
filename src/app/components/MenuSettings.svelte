<script lang="ts">
  import UserRounded from "@assets/icons/user-rounded.svg?dataurl"
  import Server from "@assets/icons/server.svg?dataurl"
  import Moon from "@assets/icons/moon.svg?dataurl"
  import Settings from "@assets/icons/settings-minimalistic.svg?dataurl"
  import Code2 from "@assets/icons/code-2.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Exit from "@assets/icons/logout-3.svg?dataurl"
  import Key from "@assets/icons/key-minimalistic.svg?dataurl"
  import Bell from "@assets/icons/bell.svg?dataurl"
  import Wallet from "@assets/icons/wallet.svg?dataurl"
  import Plugins from "@assets/icons/plug-circle.svg?dataurl"
  import Flower from "@assets/icons/flower.svg?dataurl"
  import Chart from "@assets/icons/chart.svg?dataurl"
  import Close from "@assets/icons/close.svg?dataurl"
  import {goto, preloadCode} from "$app/navigation"
  import {onMount} from "svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import CardButton from "@lib/components/CardButton.svelte"
  import LogIn from "@app/components/LogIn.svelte"
  import LogOut from "@app/components/LogOut.svelte"
  import {pubkey} from "@welshman/app"
  import {clearModals, closeTopModal, pushModal} from "@app/util/modal"
  import {makeProfilePath} from "@app/util/routes"
  import {theme} from "@app/util/theme"
  import {pushToast} from "@app/util/toast"
  import {
    CASHU_WALLET_ENABLED,
    DIAGNOSTICS_ENABLED,
    PERFORMANCE_DIAGNOSTICS_ENABLED,
  } from "@app/core/feature-flags"

  const login = () => pushModal(LogIn)

  const logout = () => pushModal(LogOut)

  const toggleTheme = () => theme.set($theme === "dark" ? "light" : "dark")

  const profilePath = $derived($pubkey ? makeProfilePath($pubkey) : "")
  let pendingHref = $state("")
  const navigationPending = $derived(Boolean(pendingHref))

  onMount(() => {
    if (!PERFORMANCE_DIAGNOSTICS_ENABLED && !DIAGNOSTICS_ENABLED) return
    const timer = window.setTimeout(() => void preloadCode("/settings/performance"), 0)
    return () => window.clearTimeout(timer)
  })

  const navigate = (event: MouseEvent, href: string) => {
    if (event.defaultPrevented) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return

    event.preventDefault()
    if (navigationPending) return

    pendingHref = href
    void goto(href, {replaceState: true}).catch(error => {
      if (pendingHref === href) pendingHref = ""
      console.error("[MenuSettings] Failed to navigate", error)
      pushToast({message: `Failed to open settings page: ${String(error)}`, theme: "error"})
    })
  }

  const dismissOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return

    event.preventDefault()
    event.stopPropagation()
    clearModals()
  }
</script>

<svelte:window onkeydown={dismissOnEscape} />

<div class="column menu gap-2">
  <header class="flex shrink-0 items-center justify-between gap-3">
    <Button
      class="btn btn-square btn-ghost h-11 min-h-11 w-11 shrink-0"
      aria-label="Close settings"
      data-modal-initial-focus
      disabled={navigationPending}
      onclick={closeTopModal}>
      <Icon icon={Close} size={7} />
    </Button>
    <h1
      class="flex min-w-0 flex-1 items-center justify-center self-stretch text-lg font-semibold leading-none">
      Settings
    </h1>
    <span class="w-11 shrink-0" aria-hidden="true"></span>
  </header>
  {#if !$pubkey}
    <Button onclick={login}>
      <CardButton class="btn-primary">
        {#snippet icon()}
          <div><Icon icon={Key} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Log in</div>
        {/snippet}
        {#snippet info()}
          <div>Connect your Nostr identity to publish and manage account settings</div>
        {/snippet}
      </CardButton>
    </Button>
  {/if}
  {#if $pubkey}
    <a
      href={profilePath}
      data-sveltekit-replacestate
      aria-busy={pendingHref === profilePath}
      aria-disabled={navigationPending}
      onclick={event => navigate(event, profilePath)}>
      <CardButton class="btn-neutral" pending={pendingHref === profilePath}>
        {#snippet icon()}
          <div><Icon icon={UserRounded} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Profile</div>
        {/snippet}
        {#snippet info()}
          <div>Customize your user profile</div>
        {/snippet}
      </CardButton>
    </a>
    <a
      href="/settings/git"
      data-sveltekit-replacestate
      aria-busy={pendingHref === "/settings/git"}
      aria-disabled={navigationPending}
      onclick={event => navigate(event, "/settings/git")}>
      <CardButton class="btn-neutral" pending={pendingHref === "/settings/git"}>
        {#snippet icon()}
          <div><Icon icon={Git} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Git</div>
        {/snippet}
        {#snippet info()}
          <div>Authentication tokens, CORS proxy, and GRASP servers</div>
        {/snippet}
      </CardButton>
    </a>
    <a
      href="/settings/notifications"
      data-sveltekit-replacestate
      aria-busy={pendingHref === "/settings/notifications"}
      aria-disabled={navigationPending}
      onclick={event => navigate(event, "/settings/notifications")}>
      <CardButton class="btn-neutral" pending={pendingHref === "/settings/notifications"}>
        {#snippet icon()}
          <div><Icon icon={Bell} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Notifications</div>
        {/snippet}
        {#snippet info()}
          <div>Manage in-app activity and community-endorsed email digests</div>
        {/snippet}
      </CardButton>
    </a>
    <a
      href="/settings/wallet"
      data-sveltekit-replacestate
      aria-busy={pendingHref === "/settings/wallet"}
      aria-disabled={navigationPending}
      onclick={event => navigate(event, "/settings/wallet")}>
      <CardButton class="btn-neutral" pending={pendingHref === "/settings/wallet"}>
        {#snippet icon()}
          <div><Icon icon={Wallet} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Wallet</div>
        {/snippet}
        {#snippet info()}
          <div>{CASHU_WALLET_ENABLED ? "Lightning and Cashu" : "Lightning"}</div>
        {/snippet}
      </CardButton>
    </a>
    <a
      href="/settings/relays"
      data-sveltekit-replacestate
      aria-busy={pendingHref === "/settings/relays"}
      aria-disabled={navigationPending}
      onclick={event => navigate(event, "/settings/relays")}>
      <CardButton class="btn-neutral" pending={pendingHref === "/settings/relays"}>
        {#snippet icon()}
          <div><Icon icon={Server} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Relays</div>
        {/snippet}
        {#snippet info()}
          <div>Control relay and network access</div>
        {/snippet}
      </CardButton>
    </a>
    <a
      href="/settings/blossom"
      data-sveltekit-replacestate
      aria-busy={pendingHref === "/settings/blossom"}
      aria-disabled={navigationPending}
      onclick={event => navigate(event, "/settings/blossom")}>
      <CardButton class="btn-neutral" pending={pendingHref === "/settings/blossom"}>
        {#snippet icon()}
          <div><Icon icon={Flower} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Blossom</div>
        {/snippet}
        {#snippet info()}
          <div>Manage media servers, uploads, optimization, and mirroring</div>
        {/snippet}
      </CardButton>
    </a>
    <a
      href="/settings/content"
      data-sveltekit-replacestate
      aria-busy={pendingHref === "/settings/content"}
      aria-disabled={navigationPending}
      onclick={event => navigate(event, "/settings/content")}>
      <CardButton class="btn-neutral" pending={pendingHref === "/settings/content"}>
        {#snippet icon()}
          <div><Icon icon={Settings} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Content Settings</div>
        {/snippet}
        {#snippet info()}
          <div>Manage how you view and publish content</div>
        {/snippet}
      </CardButton>
    </a>
    <a
      href="/settings/extensions"
      data-sveltekit-replacestate
      aria-busy={pendingHref === "/settings/extensions"}
      aria-disabled={navigationPending}
      onclick={event => navigate(event, "/settings/extensions")}>
      <CardButton class="btn-neutral" pending={pendingHref === "/settings/extensions"}>
        {#snippet icon()}
          <div><Icon icon={Plugins} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Extensions</div>
        {/snippet}
        {#snippet info()}
          <div>Install and manage extensions</div>
        {/snippet}
      </CardButton>
    </a>
  {/if}
  {#if PERFORMANCE_DIAGNOSTICS_ENABLED || DIAGNOSTICS_ENABLED}
    <a
      href="/settings/performance"
      data-sveltekit-replacestate
      aria-busy={pendingHref === "/settings/performance"}
      aria-disabled={navigationPending}
      onclick={event => navigate(event, "/settings/performance")}>
      <CardButton class="btn-neutral" pending={pendingHref === "/settings/performance"}>
        {#snippet icon()}
          <div><Icon icon={Chart} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Diagnostics</div>
        {/snippet}
        {#snippet info()}
          <div>Capture performance measurements and opt-in debug information</div>
        {/snippet}
      </CardButton>
    </a>
  {/if}
  <Button onclick={toggleTheme}>
    <CardButton class="btn-neutral">
      {#snippet icon()}
        <div><Icon icon={Moon} size={7} /></div>
      {/snippet}
      {#snippet title()}
        <div>Theme</div>
      {/snippet}
      {#snippet info()}
        <div>Switch between light and dark mode</div>
      {/snippet}
    </CardButton>
  </Button>
  <a
    href="/settings/about"
    data-sveltekit-replacestate
    aria-busy={pendingHref === "/settings/about"}
    aria-disabled={navigationPending}
    onclick={event => navigate(event, "/settings/about")}>
    <CardButton class="btn-neutral" pending={pendingHref === "/settings/about"}>
      {#snippet icon()}
        <div><Icon icon={Code2} size={7} /></div>
      {/snippet}
      {#snippet title()}
        <div>About</div>
      {/snippet}
      {#snippet info()}
        <div>Learn about this app and support the developer</div>
      {/snippet}
    </CardButton>
  </a>
  {#if $pubkey}
    <Button onclick={logout} class="btn btn-neutral">
      <Icon icon={Exit} /> Log Out
    </Button>
  {/if}
</div>
