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
  import * as nip19 from "nostr-tools/nip19"

  interface Props {
    children: Snippet
  }

  const {children}: Props = $props()

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
  const identityStatus = $derived(() => ($pubkey ? nip19.npubEncode($pubkey) : undefined))
</script>

<div class="flex h-screen overflow-hidden">
  {#if $pubkey}
    <PrimaryNav>
      {#if identityStatus}
        <div class="px-3 py-2 text-xs text-base-content/70" data-testid="identity-status">
          {identityStatus}
        </div>
      {/if}
      {@render children?.()}
    </PrimaryNav>
  {:else if !$modals[$page.url.hash.slice(1)]}
    <Landing />
  {/if}
</div>
<Toast />
