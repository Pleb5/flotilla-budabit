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
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import Button from "@lib/components/Button.svelte"
  import CardButton from "@lib/components/CardButton.svelte"
  import LogIn from "@app/components/LogIn.svelte"
  import LogOut from "@app/components/LogOut.svelte"
  import {pubkey} from "@welshman/app"
  import {clearModals, pushModal} from "@app/util/modal"
  import {makeProfilePath} from "@app/util/routes"
  import {theme} from "@app/util/theme"

  const login = () => pushModal(LogIn)

  const logout = () => pushModal(LogOut)

  const toggleTheme = () => theme.set($theme === "dark" ? "light" : "dark")

  const profilePath = $derived($pubkey ? makeProfilePath($pubkey) : "")

  const dismissOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return

    event.preventDefault()
    event.stopPropagation()
    clearModals()
  }
</script>

<svelte:window onkeydown={dismissOnEscape} />

<div class="column menu gap-2">
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
    <Link replaceState href={profilePath}>
      <CardButton class="btn-neutral">
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
    </Link>
    <Link replaceState href="/settings/git">
      <CardButton class="btn-neutral">
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
    </Link>
    {#if __ALERTS__}
      <Link replaceState href="/settings/alerts">
        <CardButton class="btn-neutral">
          {#snippet icon()}
            <div><Icon icon={Bell} size={7} /></div>
          {/snippet}
          {#snippet title()}
            <div>Alerts</div>
          {/snippet}
          {#snippet info()}
            <div>Set up email digests and push notifications</div>
          {/snippet}
        </CardButton>
      </Link>
    {/if}
    <Link replaceState href="/settings/wallet">
      <CardButton class="btn-neutral">
        {#snippet icon()}
          <div><Icon icon={Wallet} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Wallet</div>
        {/snippet}
        {#snippet info()}
          <div>Lightning and Cashu</div>
        {/snippet}
      </CardButton>
    </Link>
    <Link replaceState href="/settings/relays">
      <CardButton class="btn-neutral">
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
    </Link>
    <Link replaceState href="/settings/blossom">
      <CardButton class="btn-neutral">
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
    </Link>
    <Link replaceState href="/settings/content">
      <CardButton class="btn-neutral">
        {#snippet icon()}
          <div><Icon icon={Settings} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Content Settings</div>
        {/snippet}
        {#snippet info()}
          {#if __ALERTS__}
            <div>Manage how you view and publish content</div>
          {:else}
            <div>Manage content display, editor, and in-app notification preferences</div>
          {/if}
        {/snippet}
      </CardButton>
    </Link>
    <Link replaceState href="/settings/extensions">
      <CardButton class="btn-neutral">
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
    </Link>
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
  <Link replaceState href="/settings/about">
    <CardButton class="btn-neutral">
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
  </Link>
  {#if $pubkey}
    <Button onclick={logout} class="btn btn-neutral">
      <Icon icon={Exit} /> Log Out
    </Button>
  {/if}
</div>
