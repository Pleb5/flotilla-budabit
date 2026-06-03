<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {MESSAGE, THREAD, getTagValue, makeEvent} from "@welshman/util"
  import {pubkey, publishThunk, repository, waitForThunkCompletion} from "@welshman/app"
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

  const hasSuccessfulRelay = (thunk: ReturnType<typeof publishThunk>) =>
    Object.values(thunk.results).some(result => result.status === "success")

  const getPublishError = (thunk: ReturnType<typeof publishThunk>) => {
    const result = Object.values(thunk.results).find(result => result.status !== "success")

    return result
      ? `${result.relay}: ${result.detail || result.status}`
      : "Relay did not confirm the moderation report."
  }

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
    const thunk = publishThunk({relays: reportRelays, event: makeEvent(template.kind, template)})

    try {
      await waitForThunkCompletion(thunk)
    } catch {
      // The result map below carries the relay-specific failure detail.
    }

    if (!hasSuccessfulRelay(thunk)) {
      if (thunk.event) repository.removeEvent(thunk.event.id)
      publishStatus = "idle"
      pushToast({
        theme: "error",
        message: `${target === "content" ? "Report" : "Moderation"} failed: ${getPublishError(thunk)}`,
      })
      return
    }

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
          target === "content" ? "Report content" : target === "event" ? "Moderate event" : "Ban person",
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
