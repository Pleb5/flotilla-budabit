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

  // Core repo sub-paths that guests may view (read-only)
  const GUEST_REPO_TABS = new Set([
    "", // overview (bare repo path)
    "code",
    "commits",
    "issues",
    "patches",
    "feed",
  ])

  /**
   * Returns true when the current pathname is a public repo core route that
   * guests should be able to browse without signing in.
   *
   * Matches: /spaces/:relay/git/:naddr[/tab[/detail]]
   * where tab is one of the GUEST_REPO_TABS.
   */
  const isGuestRepoRoute = $derived.by(() => {
    const pathname = $page.url.pathname
    // Quick prefix check
    if (!pathname.startsWith("/spaces/")) return false

    // Expected shape: /spaces/<relay>/git/<naddr>[/<tab>[/<detail>]]
    const segments = pathname.replace(/\/+$/, "").split("/").filter(Boolean)
    // segments: ["spaces", relay, "git", naddr, tab?, detail?]
    if (segments.length < 4) return false
    if (segments[0] !== "spaces" || segments[2] !== "git") return false

    const tab = segments[4] ?? ""
    // For commits/:commitid and issues/:issueid and patches/:patchid, the tab
    // itself must be in the allowed set — the detail segment is fine.
    return GUEST_REPO_TABS.has(tab)
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
  {#if $pubkey}
    <PrimaryNav>
      {@render children?.()}
    </PrimaryNav>
  {:else if isGuestRepoRoute}
    {@render children?.()}
  {:else if !$modals[$page.url.hash.slice(1)]}
    <Landing />
  {/if}
</div>
<Toast />
