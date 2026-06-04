<script lang="ts">
  import type {Snippet} from "svelte"
  import {page} from "$app/stores"
  import {fly} from "@lib/transition"
  import UserCircle from "@assets/icons/user-circle.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Wallet from "@assets/icons/wallet.svg?dataurl"
  import Server from "@assets/icons/server.svg?dataurl"
  import Moon from "@assets/icons/moon.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import InfoSquare from "@assets/icons/info-square.svg?dataurl"
  import Exit from "@assets/icons/logout-3.svg?dataurl"
  import Key from "@assets/icons/key-minimalistic.svg?dataurl"
  import GalleryMinimalistic from "@assets/icons/gallery-minimalistic.svg?dataurl"
  import Flower from "@assets/icons/flower.svg?dataurl"
  import Bell from "@assets/icons/bell.svg?dataurl"
  import Plugins from "@assets/icons/plug-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Page from "@lib/components/Page.svelte"
  import SecondaryNav from "@lib/components/SecondaryNav.svelte"
  import SecondaryNavItem from "@lib/components/SecondaryNavItem.svelte"
  import SecondaryNavSection from "@lib/components/SecondaryNavSection.svelte"
  import Link from "@lib/components/Link.svelte"
  import LogIn from "@app/components/LogIn.svelte"
  import LogOut from "@app/components/LogOut.svelte"
  import {pubkey} from "@welshman/app"
  import {pushModal} from "@app/util/modal"
  import {makeProfilePath} from "@app/util/routes"
  import {theme} from "@app/util/theme"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()

  const login = () => pushModal(LogIn)

  const logout = () => pushModal(LogOut)

  const toggleTheme = () => theme.set($theme === "dark" ? "light" : "dark")

  const profilePath = $derived($pubkey ? makeProfilePath($pubkey) : "")
</script>

<SecondaryNav>
  <SecondaryNavSection>
    {#if $pubkey}
      <div in:fly|local>
        <SecondaryNavItem href={profilePath}>
          <Icon icon={UserCircle} /> Profile
        </SecondaryNavItem>
      </div>
      <div in:fly|local={{delay: 50}}>
        <SecondaryNavItem href="/settings/git">
          <Icon icon={Git} /> Git
        </SecondaryNavItem>
      </div>
      {#if __ALERTS__}
        <div in:fly|local={{delay: 100}}>
          <SecondaryNavItem href="/settings/alerts">
            <Icon icon={Bell} /> Alerts
          </SecondaryNavItem>
        </div>
      {/if}
      <div in:fly|local={{delay: 150}}>
        <SecondaryNavItem href="/settings/wallet">
          <Icon icon={Wallet} /> Wallet
        </SecondaryNavItem>
      </div>
      <div in:fly|local={{delay: 200}}>
        <SecondaryNavItem href="/settings/relays">
          <Icon icon={Server} /> Relays
        </SecondaryNavItem>
      </div>
      <div in:fly|local={{delay: 250}}>
        <SecondaryNavItem href="/settings/blossom">
          <Icon icon={Flower} /> Blossom
        </SecondaryNavItem>
      </div>
      <div in:fly|local={{delay: 300}}>
        <SecondaryNavItem href="/settings/content">
          <Icon icon={GalleryMinimalistic} /> Content
        </SecondaryNavItem>
      </div>
      <div in:fly|local={{delay: 350}}>
        <SecondaryNavItem href="/settings/extensions">
          <Icon icon={Plugins} /> Extensions
        </SecondaryNavItem>
      </div>
    {:else}
      <div in:fly|local>
        <SecondaryNavItem onclick={login}>
          <Icon icon={Key} /> Log in
        </SecondaryNavItem>
      </div>
    {/if}
    <div in:fly|local={{delay: 400}}>
      <SecondaryNavItem onclick={toggleTheme}>
        <Icon icon={Moon} /> Theme
      </SecondaryNavItem>
    </div>
    <div in:fly|local={{delay: 450}}>
      <SecondaryNavItem href="/settings/about">
        <Icon icon={InfoSquare} /> About
      </SecondaryNavItem>
    </div>
    {#if $pubkey}
      <div in:fly|local={{delay: 500}} class="lg:mb-4">
        <SecondaryNavItem class="text-error hover:text-error" onclick={logout}>
          <Icon icon={Exit} /> Log Out
        </SecondaryNavItem>
      </div>
    {/if}
  </SecondaryNavSection>
</SecondaryNav>

<Page>
  {#if $page.url.pathname !== "/settings"}
    <div class="content-padding-x hidden pb-2 pt-4 md:block lg:hidden">
      <Link href="/settings" class="btn btn-ghost btn-sm w-fit">
        <Icon icon={AltArrowLeft} /> Back
      </Link>
    </div>
  {/if}
  {@render children?.()}
</Page>
