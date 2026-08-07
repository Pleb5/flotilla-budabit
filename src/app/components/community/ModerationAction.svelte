<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {MESSAGE, THREAD, getTagValue, makeEvent} from "@welshman/util"
  import {pubkey, publishThunk, repository, retryThunk, waitForAnyRelayAck} from "@welshman/app"
  import Danger from "@assets/icons/danger.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
  } from "@app/core/community-state"
  import {COMMUNITY_SUBTYPE_ROOM_MESSAGE, normalizePubkey} from "@app/core/community"
  import {getCommunityScopedPublishRelays} from "@app/core/community-relays"
  import {
    canPublishCommunityContentReport,
    canPublishCommunityEventReport,
    canPublishCommunityPersonReport,
    getCommunityReportTargetContext,
    makeCommunityEventReport,
    makeCommunityPersonReport,
  } from "@app/core/community-reports"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"

  type Props = {
    event: TrustedEvent
    sectionName?: string
    onClick?: () => void
    mode?: "menu" | "buttons"
    replaceState?: boolean
  }

  const {
    event,
    sectionName = "",
    onClick = undefined,
    mode = "menu",
    replaceState = false,
  }: Props = $props()

  const reporterPubkey = $derived(normalizePubkey($pubkey || ""))
  let publishStatus = $state<"idle" | "publishing">("idle")
  type GovernanceThunk = ReturnType<typeof publishThunk>
  const failedReportThunks = new Map<string, GovernanceThunk>()
  const reportRelays = $derived.by(() =>
    getCommunityScopedPublishRelays($activeCommunityDefinition),
  )
  type CommunityReportAction = "content" | "event" | "person"

  const eventSubtype = $derived.by(() => {
    if (event.kind === THREAD && event.tags.some(tag => tag[0] === "room")) return "room"
    if (event.kind === MESSAGE) return COMMUNITY_SUBTYPE_ROOM_MESSAGE

    return ""
  })
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
        profileListEvents: $activeCommunityProfileListEvents,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const canReportContent = $derived.by(() =>
    Boolean(
      $activeCommunityDefinition &&
      reporterPubkey &&
      sectionName &&
      reportRelays.length > 0 &&
      !canModerateEvent &&
      canPublishCommunityContentReport({
        definition: $activeCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        reporterPubkey,
        targetPubkey: event.pubkey,
        reportState: $activeCommunityReportState,
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
        profileListEvents: $activeCommunityProfileListEvents,
        reportState: $activeCommunityReportState,
      }),
    ),
  )

  const publishCommunityReport = async (target: CommunityReportAction) => {
    if (!$activeCommunityDefinition || publishStatus === "publishing") return
    if (target === "content" && !canReportContent) return
    if (target === "event" && !canModerateEvent) return
    if (target === "person" && !canModeratePerson) return

    if (reportRelays.length === 0) {
      pushToast({theme: "error", message: "Community definition must declare at least one relay."})
      return
    }

    const targetContext = getCommunityReportTargetContext(event)
    const template =
      target === "event" || target === "content"
        ? makeCommunityEventReport({
            communityPubkey: $activeCommunityDefinition.pubkey,
            sectionName,
            eventId: event.id,
            eventPubkey: event.pubkey,
            eventKind: event.kind,
            eventSubtype,
            eventTitle: getTagValue("title", event.tags) || "",
            eventContent: event.content || "",
            ...targetContext,
          })
        : makeCommunityPersonReport({
            communityPubkey: $activeCommunityDefinition.pubkey,
            pubkey: event.pubkey,
          })

    publishStatus = "publishing"
    const operation = `community-report:${$activeCommunityDefinition.pubkey}:${target}:${sectionName}:${target === "person" ? event.pubkey : event.id}`
    const failedThunk = failedReportThunks.get(operation)
    let thunk: GovernanceThunk | undefined

    try {
      thunk = failedThunk
        ? (retryThunk(failedThunk) as GovernanceThunk)
        : publishThunk({
            relays: reportRelays,
            event: makeEvent(template.kind, template),
            optimistic: false,
          })
      await waitForAnyRelayAck(thunk, thunk.options.relays)
    } catch (error) {
      if (thunk) failedReportThunks.set(operation, thunk)
      publishStatus = "idle"
      pushToast({
        theme: "error",
        message: `${target === "content" ? "Report" : "Moderation"} failed: ${error instanceof Error ? error.message : String(error)}`,
      })
      return
    }

    failedReportThunks.delete(operation)
    repository.publish(thunk.event as TrustedEvent)
    publishStatus = "idle"
    pushToast({
      theme: "success",
      message:
        target === "content"
          ? "Report sent to community moderators."
          : target === "event"
            ? "Event moderated."
            : "Person banned.",
    })
    history.back()
  }

  const confirmModeration = (target: CommunityReportAction) => {
    onClick?.()
    pushModal(
      Confirm,
      {
        title:
          target === "content"
            ? "Report content"
            : target === "event"
              ? "Moderate event"
              : "Ban person",
        message:
          target === "content"
            ? "Send this report to community moderators for review?"
            : target === "event"
              ? "Hide this event in the current community section?"
              : "Ban this person from publishing across this community?",
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
  {#if canReportContent}
    <Button
      class={buttonClass}
      disabled={publishStatus === "publishing"}
      onclick={() => confirmModeration("content")}>
      <Icon size={4} icon={Danger} />
      {publishStatus === "publishing" ? "Publishing..." : "Report Content"}
    </Button>
  {/if}
  {#if canModerateEvent}
    <Button
      class={buttonClass}
      disabled={publishStatus === "publishing"}
      onclick={() => confirmModeration("event")}>
      <Icon size={4} icon={Danger} />
      {publishStatus === "publishing" ? "Publishing..." : "Moderate Event"}
    </Button>
  {/if}
  {#if canModeratePerson}
    <Button
      class={buttonClass}
      disabled={publishStatus === "publishing"}
      onclick={() => confirmModeration("person")}>
      <Icon size={4} icon={Danger} />
      {publishStatus === "publishing" ? "Publishing..." : "Ban Person"}
    </Button>
  {/if}
{:else}
  {#if canReportContent}
    <li>
      <Button
        class={buttonClass}
        disabled={publishStatus === "publishing"}
        onclick={() => confirmModeration("content")}>
        <Icon size={4} icon={Danger} />
        {publishStatus === "publishing" ? "Publishing..." : "Report Content"}
      </Button>
    </li>
  {/if}
  {#if canModerateEvent}
    <li>
      <Button
        class={buttonClass}
        disabled={publishStatus === "publishing"}
        onclick={() => confirmModeration("event")}>
        <Icon size={4} icon={Danger} />
        {publishStatus === "publishing" ? "Publishing..." : "Moderate Event"}
      </Button>
    </li>
  {/if}
  {#if canModeratePerson}
    <li>
      <Button
        class={buttonClass}
        disabled={publishStatus === "publishing"}
        onclick={() => confirmModeration("person")}>
        <Icon size={4} icon={Danger} />
        {publishStatus === "publishing" ? "Publishing..." : "Ban Person"}
      </Button>
    </li>
  {/if}
{/if}
