<script lang="ts">
  import {writable} from "svelte/store"
  import {request} from "@welshman/net"
  import {pubkey, publishThunk, repository, waitForThunkCompletion} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, type TrustedEvent} from "@welshman/util"
  import Field from "@lib/components/Field.svelte"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileSingleSelect from "@app/components/ProfileSingleSelect.svelte"
  import {preventDefault} from "@lib/html"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {normalizePubkey, normalizeRelays} from "@app/core/community"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityRelays,
    activeCommunityReportState,
    getCommunityBadgeRelays,
  } from "@app/core/community-state"
  import {
    canCreateCommunityBadge,
    makeCommunityBadgeAwardEvent,
    makeCommunityBadgeDefinitionFilters,
    selectCommunityBadgeDefinitions,
    type CommunityBadgeDefinition,
  } from "@app/core/community-badges"

  type Props = {
    recipientPubkey?: string
    title?: string
    description?: string
    showIfUnavailable?: boolean
    onAwarded?: () => void
    [key: string]: any
  }

  const {
    recipientPubkey = "",
    title = "Award badge",
    description = "Badge awards publish one immutable award event for exactly one recipient.",
    showIfUnavailable = false,
    onAwarded,
    ...props
  }: Props = $props()

  const communityPubkey = $derived($activeCommunityDefinition?.pubkey || "")
  const communityBootstrapReady = $derived(
    Boolean(
      communityPubkey &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const badgeRelays = $derived(
    normalizeRelays(getCommunityBadgeRelays(communityBootstrapReady ? $activeCommunityRelays : [])),
  )
  const canManageBadges = $derived(
    Boolean(
      communityBootstrapReady &&
      $activeCommunityDefinition &&
      $pubkey &&
      canCreateCommunityBadge({
        definition: $activeCommunityDefinition,
        pubkey: $pubkey,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const badgeDefinitionFilters = $derived(
    communityBootstrapReady && $activeCommunityDefinition
      ? makeCommunityBadgeDefinitionFilters({
          definition: $activeCommunityDefinition,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const badgeDefinitionEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: badgeDefinitionFilters})),
  )
  const badgeDefinitions = $derived.by((): CommunityBadgeDefinition[] =>
    $activeCommunityDefinition
      ? selectCommunityBadgeDefinitions({
          definition: $activeCommunityDefinition,
          badgeDefinitionEvents: $badgeDefinitionEvents,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const ownActiveBadgeDefinitions = $derived(
    badgeDefinitions.filter(definition => definition.pubkey === normalizePubkey($pubkey || "")),
  )

  const term = writable("")

  let selectedDefinitionAddress = $state("")
  let selectedRecipientPubkey = $state("")
  let publishing = $state(false)

  const selectedDefinition = $derived(
    ownActiveBadgeDefinitions.find(definition => definition.address === selectedDefinitionAddress),
  )
  const targetPubkey = $derived(normalizePubkey(recipientPubkey || selectedRecipientPubkey))

  const hasSuccessfulRelay = (thunk: ReturnType<typeof publishThunk>) =>
    Object.values(thunk.results).some(result => result.status === "success")

  const getPublishError = (thunk: ReturnType<typeof publishThunk>) => {
    const result = Object.values(thunk.results).find(result => result.status !== "success")

    return result ? `${result.relay}: ${result.detail || result.status}` : "No relay confirmed."
  }

  const publishTemplate = async (template: {kind: number; content: string; tags: string[][]}) => {
    if (badgeRelays.length === 0) throw new Error("No badge relays are available.")

    const thunk = publishThunk({relays: badgeRelays, event: makeEvent(template.kind, template)})
    await waitForThunkCompletion(thunk)
    if (!hasSuccessfulRelay(thunk)) throw new Error(getPublishError(thunk))
    repository.publish(thunk.event as TrustedEvent)
  }

  const runPublish = async (action: () => Promise<void>, successMessage: string) => {
    publishing = true
    try {
      await action()
      pushToast({theme: "success", message: successMessage})
      return true
    } catch (error) {
      pushToast({theme: "error", message: error instanceof Error ? error.message : String(error)})
      return false
    } finally {
      publishing = false
    }
  }

  const confirmAction = ({
    title,
    message,
    confirm,
  }: {
    title: string
    message: string
    confirm: () => Promise<boolean>
  }) => {
    pushModal(Confirm, {
      title,
      message,
      confirm: async () => {
        if (await confirm()) history.back()
      },
    })
  }

  const awardBadge = () => {
    if (!canManageBadges || !selectedDefinition) {
      pushToast({theme: "error", message: "Select one of your active badge definitions first."})
      return
    }
    if (!targetPubkey) {
      pushToast({theme: "error", message: "Choose one recipient or paste an npub."})
      return
    }

    confirmAction({
      title: "Award badge",
      message: `Award ${selectedDefinition.name} to ${recipientPubkey ? "this profile" : "the selected person"}?`,
      confirm: () =>
        runPublish(async () => {
          await publishTemplate(
            makeCommunityBadgeAwardEvent({
              definitionAddress: selectedDefinition.address,
              recipientPubkey: targetPubkey,
            }),
          )
          selectedRecipientPubkey = ""
          term.set("")
          onAwarded?.()
        }, "Badge award published."),
    })
  }

  $effect(() => {
    if (
      ownActiveBadgeDefinitions.some(definition => definition.address === selectedDefinitionAddress)
    )
      return

    selectedDefinitionAddress = ownActiveBadgeDefinitions[0]?.address || ""
  })

  $effect(() => {
    if (!communityBootstrapReady || badgeRelays.length === 0) return

    const filters = [...badgeDefinitionFilters]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({relays: badgeRelays, autoClose: true, filters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

{#if canManageBadges}
  <form class="flex flex-col gap-3 {props.class || ''}" onsubmit={preventDefault(awardBadge)}>
    <div>
      <h2 class="text-xl font-semibold">{title}</h2>
      <p class="text-sm opacity-70">{description}</p>
    </div>
    <Field>
      {#snippet label()}<p>Your badge</p>{/snippet}
      {#snippet input()}
        <select
          class="select select-bordered w-full"
          bind:value={selectedDefinitionAddress}
          disabled={ownActiveBadgeDefinitions.length === 0}>
          {#each ownActiveBadgeDefinitions as definition (definition.address)}
            <option value={definition.address}>{definition.name}</option>
          {/each}
        </select>
      {/snippet}
      {#snippet info()}
        {ownActiveBadgeDefinitions.length === 0
          ? "Create an active badge before awarding it."
          : "Only badges created by your current pubkey can be awarded by you."}
      {/snippet}
    </Field>
    {#if recipientPubkey}
      <div class="rounded-box bg-base-200 p-3">
        <p class="text-xs font-semibold uppercase tracking-wide opacity-60">Recipient</p>
        <p class="mt-1 text-sm"><ProfileName pubkey={targetPubkey} /></p>
      </div>
    {:else}
      <Field>
        {#snippet label()}<p>Recipient</p>{/snippet}
        {#snippet input()}
          <ProfileSingleSelect bind:value={selectedRecipientPubkey} {term} />
        {/snippet}
        {#snippet info()}Search by name or paste a pubkey/npub. One award event is published for one
          person.{/snippet}
      </Field>
    {/if}
    <div class="flex justify-end">
      <Button
        type="submit"
        class="btn btn-primary"
        disabled={publishing || !selectedDefinitionAddress || !targetPubkey}>
        <Spinner loading={publishing}>Award badge</Spinner>
      </Button>
    </div>
  </form>
{:else if showIfUnavailable && communityBootstrapLoading}
  <p class="flex items-center justify-center py-6 text-sm opacity-70">
    <Spinner loading>Loading badge permissions...</Spinner>
  </p>
{:else if showIfUnavailable}
  <p class="rounded-box bg-base-200 p-4 text-sm opacity-70">
    Badge awarding is available to the community admin and active moderators.
  </p>
{/if}
