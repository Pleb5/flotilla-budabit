<script lang="ts">
  import {tick} from "svelte"
  import {page} from "$app/stores"
  import {pubkey, publishThunk} from "@welshman/app"
  import {makeEvent} from "@welshman/util"
  import Settings from "@assets/icons/settings.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {getCommunitySectionDisplayName, getProfileListPubkeys, normalizePubkey} from "@app/core/community"
  import {makeCommunityGrantEvents, makeCommunityRevokeEvent} from "@app/core/community-admin"
  import {findProfileListEvent, getGrantCapability} from "@app/core/community-permissions"
  import {parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const sections = $derived($activeCommunityDefinition?.sections || [])
  const capabilities = $derived(
    sections.map(section => ({
      section,
      displayName: getCommunitySectionDisplayName(section),
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
  const canViewAdmin = $derived(
    Boolean(
      $pubkey &&
      $activeCommunityDefinition &&
      normalizePubkey($pubkey) === normalizePubkey($activeCommunityDefinition.pubkey),
    ),
  )

  const grant = () => {
    const normalized = normalizePubkey(targetPubkey)
    if (!canViewAdmin) {
      pushToast({theme: "error", message: "Only the community owner can administer access."})
      return
    }

    if (
      !selected?.capability?.canGrant ||
      !selected.capability.profileList ||
      !selected.capability.badge ||
      !normalized
    ) {
      pushToast({
        theme: "error",
        message: "You need list-manager and badge-issuer authority for this section.",
      })
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
    if (!canViewAdmin) {
      pushToast({theme: "error", message: "Only the community owner can administer access."})
      return
    }

    if (!selected?.capability?.canGrant || !selected.capability.profileList) {
      pushToast({
        theme: "error",
        message: "You need list-manager and badge-issuer authority for this section.",
      })
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
  let grantForm: HTMLFormElement | undefined = $state()
  let targetPubkeyInput: HTMLInputElement | undefined = $state()

  const selectSection = async (sectionName: string) => {
    selectedSection = sectionName

    await tick()

    grantForm?.scrollIntoView({behavior: "smooth", block: "start"})
    targetPubkeyInput?.focus({preventScroll: true})
  }

  $effect(() => {
    if (!canViewAdmin) {
      selectedSection = ""
      return
    }

    if (!selectedSection && sections[0]) selectedSection = sections[0].name
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={Settings} /></div>
  {/snippet}
  {#snippet title()}<strong>Community Admin</strong>{/snippet}
  {#snippet action()}
    <CommunityMenuButton community={communityPubkey} />
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  {#if !$activeCommunityDefinition}
    <p class="py-8 text-center opacity-70">Community definition is not loaded.</p>
  {:else if !canViewAdmin}
    <p class="py-8 text-center opacity-70">Only the community owner can access admin tools.</p>
  {:else}
    <div class="grid gap-2 sm:grid-cols-2">
      {#each capabilities as item}
        {@const isSelected = selectedSection === item.section.name}
        <button
          type="button"
          class="card2 border p-4 text-left shadow-md transition-colors {isSelected
            ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
            : 'bg-alt border-base-300 hover:bg-base-200'}"
          aria-pressed={isSelected}
          onclick={() => selectSection(item.section.name)}>
          <div class="flex items-center justify-between gap-2">
            <strong>{item.displayName}</strong>
            {#if isSelected}
              <span class="badge badge-primary badge-sm">Selected</span>
            {/if}
          </div>
          <p class="text-sm opacity-70">
            {item.capability?.canGrant ? "Grant/revoke enabled" : "Read-only for this signer"}
          </p>
        </button>
      {/each}
    </div>

    {#if selected}
      <form
        class="card2 bg-alt col-3 scroll-mt-24 p-4 shadow-md"
        bind:this={grantForm}
        onsubmit={preventDefault(grant)}>
        <strong>Grant access to {selected.displayName}</strong>
        <Field>
          {#snippet label()}<p>Pubkey or npub</p>{/snippet}
          {#snippet input()}<input
              bind:this={targetPubkeyInput}
              bind:value={targetPubkey}
              class="input input-bordered w-full" />{/snippet}
        </Field>
        <div class="flex justify-end">
          <Button
            type="submit"
            class="btn btn-primary"
            disabled={!selected.capability?.canGrant || !targetPubkey.trim()}>
            Grant access
          </Button>
        </div>
      </form>

      <div class="card2 bg-alt col-2 p-4 shadow-md">
        <strong>Current writers</strong>
        {#each selectedPubkeys as listedPubkey}
          <div class="flex items-center justify-between gap-2">
            <code class="truncate text-xs">{listedPubkey}</code>
            <Button
              class="btn btn-error btn-xs"
              disabled={!selected.capability?.canGrant}
              onclick={() => revoke(listedPubkey)}>
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
