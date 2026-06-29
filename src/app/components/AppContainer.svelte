<script lang="ts">
  import type {Snippet} from "svelte"
  import {page} from "$app/stores"
  import {pubkey} from "@welshman/app"
  import Landing from "@app/components/Landing.svelte"
  import Toast from "@app/components/Toast.svelte"
  import PrimaryNav from "@app/components/PrimaryNav.svelte"
  import EmailConfirm from "@app/components/EmailConfirm.svelte"
  import PasswordReset from "@app/components/PasswordReset.svelte"
  import {BURROW_URL} from "@app/core/state"
  import {modals, pushModal} from "@app/util/modal"

  interface Props {
    children: Snippet
  }

  const {children}: Props = $props()

  const isGuestCommunityRoute = $derived($page.url.pathname.startsWith("/c/"))
  const isPublicRoute = $derived.by(() => {
    const pathname = $page.url.pathname
    const routeId = $page.route.id || ""

    return (
      pathname === "/" ||
      pathname === "/home" ||
      pathname === "/trust-model" ||
      pathname === "/community-guide" ||
      pathname === "/communities" ||
      pathname.startsWith("/communities/") ||
      pathname === "/explore" ||
      pathname.startsWith("/explore/") ||
      pathname === "/people" ||
      pathname.startsWith("/people/") ||
      pathname === "/git" ||
      pathname.startsWith("/git/") ||
      pathname === "/settings/about" ||
      isGuestCommunityRoute ||
      routeId === "/[bech32]"
    )
  })

  if (BURROW_URL && !$pubkey) {
    if ($page.url.pathname === "/confirm-email") {
      pushModal(EmailConfirm, {
        email: $page.url.searchParams.get("email"),
        confirm_token: $page.url.searchParams.get("confirm_token"),
      })
    }

    if ($page.url.pathname === "/reset-password") {
      pushModal(PasswordReset, {
        email: $page.url.searchParams.get("email"),
        reset_token: $page.url.searchParams.get("reset_token"),
      })
    }
  }
</script>

<div class="flex h-screen overflow-hidden">
  {#if $pubkey || isPublicRoute}
    <PrimaryNav>
      {@render children?.()}
    </PrimaryNav>
  {:else if !$modals[$page.url.hash.slice(1)]}
    <Landing />
  {/if}
</div>
<Toast />
