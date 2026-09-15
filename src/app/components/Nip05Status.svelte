<script lang="ts">
  import type {Instance} from "tippy.js"
  import {CircleHelp} from "@lucide/svelte"
  import Tooltip from "@lib/components/Tooltip.svelte"
  import type {IdentityVerification} from "@app/util/profile-identity"
  import IdentityStatus from "./IdentityStatus.svelte"

  const {
    address,
    result,
    loading = false,
  }: {address?: string; result?: IdentityVerification; loading?: boolean} = $props()
  let instance = $state<Instance>()
  const content = $derived(
    loading
      ? "Checking that this NIP-05 address points to this profile's Nostr public key…"
      : result?.message ||
          "NIP-05 links a readable address, such as name@example.com, to your Nostr public key.",
  )

  // Verification is asynchronous; keep an already-open tooltip up to date.
  $effect(() => {
    if (instance && !instance.state.isDestroyed) instance.setContent(content)
  })
</script>

<Tooltip {content} trigger="mouseenter focusin click" bind:instance class="min-w-0">
  <button
    type="button"
    class="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    aria-label={address
      ? `NIP-05 verification details for ${address}`
      : "NIP-05 verification details"}
    aria-describedby={instance?.popper.id}
    onkeydown={event => {
      if (event.key === "Escape" && instance?.state.isVisible) {
        instance.hide()
        event.stopPropagation()
      }
    }}>
    {#if address}<span class="min-w-0 break-all">{address}</span>{/if}
    {#if result || loading}
      <IdentityStatus {result} {loading} showTitle={false} />
    {:else}
      <CircleHelp class="h-4 w-4 shrink-0 opacity-60" />
    {/if}
  </button>
</Tooltip>
