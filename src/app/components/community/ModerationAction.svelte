<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {makeEvent} from "@welshman/util"
  import {pubkey, publishThunk} from "@welshman/app"
  import Danger from "@assets/icons/danger.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import {activeCommunityDefinition, activeCommunityRelays} from "@app/core/community-state"
  import {normalizePubkey} from "@app/core/community"
  import {
    canPublishCommunityEventReport,
    canPublishCommunityPersonReport,
    makeCommunityEventReport,
    makeCommunityPersonReport,
  } from "@app/core/community-reports"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"

  type Props = {
    event: TrustedEvent
    sectionName?: string
    relays?: string[]
    onClick?: () => void
    mode?: "menu" | "buttons"
    replaceState?: boolean
  }

  const {
    event,
    sectionName = "",
    relays = [],
    onClick = undefined,
    mode = "menu",
    replaceState = false,
  }: Props = $props()

  const reporterPubkey = $derived(normalizePubkey($pubkey || ""))
  const reportRelays = $derived.by(() =>
    (relays.length > 0 ? relays : $activeCommunityRelays).filter(Boolean),
  )
  const canModerateEvent = $derived.by(() =>
    Boolean(
      $activeCommunityDefinition &&
      reporterPubkey &&
      sectionName &&
      reportRelays.length > 0 &&
      canPublishCommunityEventReport({
        definition: $activeCommunityDefinition,
        reporterPubkey,
        targetPubkey: event.pubkey,
        sectionName,
      }),
    ),
  )
  const canModeratePerson = $derived.by(() =>
    Boolean(
      $activeCommunityDefinition &&
      reporterPubkey &&
      reportRelays.length > 0 &&
      canPublishCommunityPersonReport({
        definition: $activeCommunityDefinition,
        reporterPubkey,
        targetPubkey: event.pubkey,
      }),
    ),
  )

  const publishCommunityReport = async (target: "event" | "person") => {
    if (!$activeCommunityDefinition || reportRelays.length === 0) return

    const template =
      target === "event"
        ? makeCommunityEventReport({
            communityPubkey: $activeCommunityDefinition.pubkey,
            sectionName,
            eventId: event.id,
            eventPubkey: event.pubkey,
          })
        : makeCommunityPersonReport({
            communityPubkey: $activeCommunityDefinition.pubkey,
            pubkey: event.pubkey,
          })

    publishThunk({relays: reportRelays, event: makeEvent(template.kind, template)})
    pushToast({message: target === "event" ? "Event moderated." : "Person moderated."})
    history.back()
  }

  const confirmModeration = (target: "event" | "person") => {
    onClick?.()
    pushModal(
      Confirm,
      {
        title: target === "event" ? "Moderate event" : "Moderate person",
        subtitle: "Publish a community NIP-56 spam report.",
        message:
          target === "event"
            ? "Hide this event in the current community section?"
            : "Hide this person's content across this community?",
        confirm: () => publishCommunityReport(target),
      },
      {replaceState},
    )
  }

  const buttonClass = $derived(
    mode === "buttons" ? "btn btn-neutral w-full text-error" : "text-error",
  )
</script>

{#if mode === "buttons"}
  {#if canModerateEvent}
    <Button class={buttonClass} onclick={() => confirmModeration("event")}>
      <Icon size={4} icon={Danger} />
      Moderate Event
    </Button>
  {/if}
  {#if canModeratePerson}
    <Button class={buttonClass} onclick={() => confirmModeration("person")}>
      <Icon size={4} icon={Danger} />
      Moderate Person
    </Button>
  {/if}
{:else}
  {#if canModerateEvent}
    <li>
      <Button class={buttonClass} onclick={() => confirmModeration("event")}>
        <Icon size={4} icon={Danger} />
        Moderate Event
      </Button>
    </li>
  {/if}
  {#if canModeratePerson}
    <li>
      <Button class={buttonClass} onclick={() => confirmModeration("person")}>
        <Icon size={4} icon={Danger} />
        Moderate Person
      </Button>
    </li>
  {/if}
{/if}
