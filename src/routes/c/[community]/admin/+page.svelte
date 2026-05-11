<script lang="ts">
  import {pubkey, publishThunk} from "@welshman/app"
  import {makeEvent} from "@welshman/util"
  import Settings from "@assets/icons/settings.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {getProfileListPubkeys, normalizePubkey} from "@app/core/community"
  import {makeCommunityGrantEvents, makeCommunityRevokeEvent} from "@app/core/community-admin"
  import {findProfileListEvent, getGrantCapability} from "@app/core/community-permissions"

  const sections = $derived($activeCommunityDefinition?.sections || [])
  const capabilities = $derived(
    sections.map(section => ({
      section,
      capability: $pubkey
        ? getGrantCapability({
            definition: $activeCommunityDefinition!,
            userPubkey: $pubkey,
            sectionName: section.name,
          })
        : undefined,
    })),
  )
  const selected = $derived(capabilities.find(item => item.section.name === selectedSection))
  const selectedProfileListEvent = $derived(
    selected?.capability?.profileList
      ? findProfileListEvent(selected.capability.profileList, $activeCommunityProfileListEvents)
      : undefined,
  )
  const selectedPubkeys = $derived(getProfileListPubkeys(selectedProfileListEvent))

  const grant = () => {
    const normalized = normalizePubkey(targetPubkey)
    if (!selected?.capability?.canGrant || !selected.capability.profileList || !selected.capability.badge || !normalized) {
      pushToast({theme: "error", message: "You need list-manager and badge-issuer authority for this section."})
      return
    }

    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    const events = makeCommunityGrantEvents({
      profileList: selected.capability.profileList,
      profileListEvent: selectedProfileListEvent,
      badge: selected.capability.badge,
      pubkey: normalized,
    })

    publishThunk({relays, event: makeEvent(events.profileList.kind, events.profileList)})
    publishThunk({relays, event: makeEvent(events.badgeAward.kind, events.badgeAward)})
    targetPubkey = ""
    pushToast({message: "Access granted."})
  }

  const revoke = (revokedPubkey: string) => {
    if (!selected?.capability?.canGrant || !selected.capability.profileList) {
      pushToast({theme: "error", message: "You need list-manager and badge-issuer authority for this section."})
      return
    }

    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    const event = makeCommunityRevokeEvent({
      profileList: selected.capability.profileList,
      profileListEvent: selectedProfileListEvent,
      pubkey: revokedPubkey,
    })

    publishThunk({relays, event: makeEvent(event.kind, event)})
    pushToast({message: "Access revoked."})
  }

  let selectedSection = $state("")
  let targetPubkey = $state("")

  $effect(() => {
    if (!selectedSection && sections[0]) selectedSection = sections[0].name
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={Settings} /></div>
  {/snippet}
  {#snippet title()}<strong>Community Admin</strong>{/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  {#if !$activeCommunityDefinition}
    <p class="py-8 text-center opacity-70">Community definition is not loaded.</p>
  {:else}
    <div class="grid gap-2 sm:grid-cols-2">
      {#each capabilities as item}
        <button
          type="button"
          class="card2 bg-alt p-4 text-left shadow-md"
          class:border-primary={selectedSection === item.section.name}
          onclick={() => (selectedSection = item.section.name)}>
          <strong>{item.section.name}</strong>
          <p class="text-sm opacity-70">
            {item.capability?.canGrant ? "Grant/revoke enabled" : "Read-only for this signer"}
          </p>
        </button>
      {/each}
    </div>

    {#if selected}
      <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(grant)}>
        <strong>Grant access to {selected.section.name}</strong>
        <Field>
          {#snippet label()}<p>Pubkey or npub</p>{/snippet}
          {#snippet input()}<input bind:value={targetPubkey} class="input input-bordered w-full" />{/snippet}
        </Field>
        <div class="flex justify-end">
          <Button type="submit" class="btn btn-primary" disabled={!selected.capability?.canGrant || !targetPubkey.trim()}>
            Grant access
          </Button>
        </div>
      </form>

      <div class="card2 bg-alt col-2 p-4 shadow-md">
        <strong>Current writers</strong>
        {#each selectedPubkeys as listedPubkey}
          <div class="flex items-center justify-between gap-2">
            <code class="truncate text-xs">{listedPubkey}</code>
            <Button class="btn btn-error btn-xs" disabled={!selected.capability?.canGrant} onclick={() => revoke(listedPubkey)}>
              Revoke
            </Button>
          </div>
        {:else}
          <p class="opacity-70">No writers in this section list.</p>
        {/each}
      </div>
    {/if}
  {/if}
</PageContent>
