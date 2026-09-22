<script lang="ts">
  import {onDestroy} from "svelte"
  import {goto} from "$app/navigation"
  import {pubkey, messagingRelayListsByPubkey} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Close from "@assets/icons/close.svg?dataurl"
  import DmRelayRecommendations from "@app/components/DmRelayRecommendations.svelte"
  import {getDmRelayUrls} from "@app/core/dm"
  import {addDmInboxRelay, DM_RELAY_SETTINGS_URL} from "@app/core/dm-inbox-setup"
  import {closeTopModal, modal} from "@app/util/modal"

  const {expectedPubkey}: {expectedPubkey: string} = $props()
  let addingRelay = $state("")
  let error = $state("")
  let mounted = true
  onDestroy(() => {
    mounted = false
  })
  const configured = $derived(
    getDmRelayUrls($messagingRelayListsByPubkey.get(expectedPubkey)).length > 0,
  )

  const addRelay = async (url: string) => {
    if (addingRelay || $pubkey !== expectedPubkey) return
    addingRelay = url
    error = ""
    try {
      await addDmInboxRelay(url, expectedPubkey)
      if (mounted && $modal?.props.expectedPubkey === expectedPubkey) closeTopModal()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Could not save your DM inbox relay."
    } finally {
      addingRelay = ""
    }
  }

  const openSettings = () => {
    closeTopModal()
    void goto(DM_RELAY_SETTINGS_URL)
  }
</script>

<div class="column gap-4">
  <header class="flex items-center justify-between gap-3">
    <h2 class="text-xl font-semibold">Set up your DM inbox</h2>
    <Button
      class="btn btn-square btn-ghost h-11 min-h-11 w-11 shrink-0"
      aria-label="Close DM inbox setup"
      disabled={Boolean(addingRelay)}
      onclick={closeTopModal}>
      <Icon icon={Close} size={6} />
    </Button>
  </header>
  <p>
    You haven’t configured a DM inbox relay yet. Both participants need at least one before messages
    can be sent. Choose a recommended relay below, or configure your own in settings.
  </p>
  <p class="text-sm opacity-70">
    Your communities’ current primary relays appear first. Choosing “Use for DMs” publishes that
    relay in your messaging relay list so people know where to send your messages.
  </p>
  {#if $pubkey !== expectedPubkey}
    <p role="alert" class="text-error">Your account changed. Reopen DM setup to continue.</p>
  {:else if configured && !addingRelay}
    <p role="status" class="text-success">Your DM inbox is configured.</p>
  {:else}
    <DmRelayRecommendations
      onAdd={addRelay}
      disabled={Boolean(addingRelay)}
      {addingRelay}
      addLabel="Use for DMs" />
  {/if}
  {#if error}
    <p role="alert" class="text-error">{error}</p>
  {/if}
  <div class="flex flex-wrap justify-end gap-2">
    <Button class="btn btn-ghost" disabled={Boolean(addingRelay)} onclick={closeTopModal}>
      {configured ? "Done" : "Not now"}
    </Button>
    <Button class="btn btn-outline" disabled={Boolean(addingRelay)} onclick={openSettings}>
      Open messaging relay settings
    </Button>
  </div>
</div>
