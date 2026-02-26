<script lang="ts">
  import type {Snippet} from "svelte"
  import {page} from "$app/stores"
  import {fly} from "@lib/transition"
  import UserCircle from "@assets/icons/user-circle.svg?dataurl"
  import Wallet from "@assets/icons/wallet.svg?dataurl"
  import Server from "@assets/icons/server.svg?dataurl"
  import Moon from "@assets/icons/moon.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import InfoSquare from "@assets/icons/info-square.svg?dataurl"
  import Refresh from "@assets/icons/refresh.svg?dataurl"
  import Exit from "@assets/icons/logout-3.svg?dataurl"
  import GalleryMinimalistic from "@assets/icons/gallery-minimalistic.svg?dataurl"
  import Bell from "@assets/icons/bell.svg?dataurl"
  import Plugins from "@assets/icons/plug-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Page from "@lib/components/Page.svelte"
  import SecondaryNav from "@lib/components/SecondaryNav.svelte"
  import SecondaryNavItem from "@lib/components/SecondaryNavItem.svelte"
  import SecondaryNavSection from "@lib/components/SecondaryNavSection.svelte"
  import Link from "@lib/components/Link.svelte"
  import LogOut from "@app/components/LogOut.svelte"
  import ResetAppCacheConfirm from "@app/components/ResetAppCacheConfirm.svelte"
  import {pushModal} from "@app/util/modal"
  import {theme} from "@app/util/theme"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()

  const logout = () => pushModal(LogOut)
  const resetAppCache = () => pushModal(ResetAppCacheConfirm)

  const toggleTheme = () => theme.set($theme === "dark" ? "light" : "dark")
</script>

<SecondaryNav>
  <SecondaryNavSection>
    <div in:fly|local>
      <SecondaryNavItem href="/settings/profile">
        <Icon icon={UserCircle} /> Profile
      </SecondaryNavItem>
    </div>
    <div in:fly|local={{delay: 50}}>
      <SecondaryNavItem href="/settings/alerts">
        <Icon icon={Bell} /> Alerts
      </SecondaryNavItem>
    </div>
    <div in:fly|local={{delay: 100}}>
      <SecondaryNavItem href="/settings/wallet">
        <Icon icon={Wallet} /> Wallet
      </SecondaryNavItem>
    </div>
    <div in:fly|local={{delay: 150}}>
      <SecondaryNavItem href="/settings/relays">
        <Icon icon={Server} /> Relays
      </SecondaryNavItem>
    </div>
    <div in:fly|local={{delay: 200}}>
      <SecondaryNavItem href="/settings/content">
        <Icon icon={GalleryMinimalistic} /> Content
      </SecondaryNavItem>
    </div>
    <div in:fly|local={{delay: 225}}>
      <SecondaryNavItem href="/settings/extensions">
        <Icon icon={Plugins} /> Extensions
      </SecondaryNavItem>
    </div>
    <div in:fly|local={{delay: 250}}>
      <SecondaryNavItem onclick={toggleTheme}>
        <Icon icon={Moon} /> Theme
      </SecondaryNavItem>
    </div>
    <div in:fly|local={{delay: 300}}>
      <SecondaryNavItem href="/settings/about">
        <Icon icon={InfoSquare} /> About
      </SecondaryNavItem>
    </div>
    <div in:fly|local={{delay: 325}} class="mb-2">
      <SecondaryNavItem class="text-warning hover:text-warning" onclick={resetAppCache}>
        <Icon icon={Refresh} /> Reset App Cache
      </SecondaryNavItem>
    </div>
    <div in:fly|local={{delay: 350}}>
      <SecondaryNavItem class="text-error hover:text-error" onclick={logout}>
        <Icon icon={Exit} /> Log Out
      </SecondaryNavItem>
    </div>
  </SecondaryNavSection>
</SecondaryNav>

<Page>
  {#if $page.url.pathname !== "/settings"}
    <div class="content-padding-x pb-2 pt-4 hidden md:block lg:hidden">
      <Link href="/settings" class="btn btn-ghost btn-sm w-fit">
        <Icon icon={AltArrowLeft} /> Back
      </Link>
    </div>
  {/if}
  {@render children?.()}
</Page>
