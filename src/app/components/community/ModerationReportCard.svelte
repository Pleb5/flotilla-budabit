<script lang="ts">
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import type {TrustedEvent} from "@welshman/util"
  import {
    COMMENT,
    EVENT_DATE,
    EVENT_TIME,
    MESSAGE,
    NOTE,
    THREAD,
    ZAP_GOAL,
    getTagValue,
    makeEvent,
  } from "@welshman/util"
  import {pubkey, publishThunk, repository, waitForThunkCompletion} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {activeCommunityRelays, loadCommunityEvents} from "@app/core/community-state"
  import {TARGETED_PUBLICATION_KIND, normalizePubkey} from "@app/core/community"
  import {
    makeCommunityReportDelete,
    type CommunityModerationAction,
  } from "@app/core/community-reports"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"

  type Props = {
    report: CommunityModerationAction
    relays?: string[]
    showReporter?: boolean
  }

  const {report, relays = [], showReporter = false}: Props = $props()

  let revokeStatus = $state<"idle" | "publishing">("idle")
  let targetEventLoadStatus = $state<"idle" | "loading" | "done">("idle")

  const currentPubkey = $derived(normalizePubkey($pubkey || ""))
  const reportRelays = $derived(
    (relays.length > 0 ? relays : $activeCommunityRelays).filter(Boolean),
  )
  const canRevoke = $derived(Boolean(currentPubkey && report.reporterPubkey === currentPubkey))
  const revokeLabel = $derived(report.target === "event" ? "Uncensor" : "Unban")
  const targetLabel = $derived(report.target === "event" ? "Event" : "Person")

  const getTargetEventKindLabelFromParts = (kind: number, subtype = "") => {
    if (kind === THREAD) return subtype === "room" ? "Room" : "Thread"
    if (kind === MESSAGE) return "Room message"
    if (kind === COMMENT) return "Comment"
    if (kind === EVENT_DATE || kind === EVENT_TIME) return "Calendar event"
    if (kind === ZAP_GOAL) return "Goal"
    if (kind === NOTE) return "Note"
    if (kind === TARGETED_PUBLICATION_KIND) return "Community targeting update"

    return `Kind ${kind}`
  }

  const getTargetEventKindLabel = (event: TrustedEvent) => {
    const subtype = event.kind === THREAD && event.tags.some(tag => tag[0] === "room") ? "room" : ""

    return getTargetEventKindLabelFromParts(event.kind, subtype)
  }

  const targetEventFilters = $derived(
    report.target === "event" && report.targetEventId ? [{ids: [report.targetEventId]}] : [{ids: [""]}],
  )
  const targetEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetEventFilters, includeDeleted: true})),
  )
  const targetEvent = $derived($targetEvents[0])
  const targetEventKindNumber = $derived(targetEvent?.kind ?? report.targetEventKind)
  const targetEventTitle = $derived(
    targetEvent ? (getTagValue("title", targetEvent.tags) || "").trim() : report.targetEventTitle || "",
  )
  const targetEventContent = $derived(targetEvent?.content?.trim() || report.targetEventContent || "")
  const targetEventKind = $derived.by(() => {
    if (report.target !== "event") return ""
    if (!targetEvent) {
      if (report.targetEventKind !== undefined) {
        return getTargetEventKindLabelFromParts(report.targetEventKind, report.targetEventSubtype)
      }

      return targetEventLoadStatus === "done" || reportRelays.length === 0
        ? "Event unavailable"
        : "Loading event..."
    }

    return getTargetEventKindLabel(targetEvent)
  })

  let targetEventLoadKey = ""

  const hasSuccessfulRelay = (thunk: ReturnType<typeof publishThunk>) =>
    Object.values(thunk.results).some(result => result.status === "success")

  const getPublishError = (thunk: ReturnType<typeof publishThunk>) => {
    const result = Object.values(thunk.results).find(result => result.status !== "success")

    return result
      ? `${result.relay}: ${result.detail || result.status}`
      : "Relay did not confirm the report delete."
  }

  const publishReportDelete = async () => {
    if (!canRevoke) {
      pushToast({theme: "error", message: "Only the reporting moderator can revoke this action."})
      return
    }

    if (reportRelays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    revokeStatus = "publishing"
    const template = makeCommunityReportDelete({reportId: report.event.id})
    const thunk = publishThunk({relays: reportRelays, event: makeEvent(template.kind, template)})

    try {
      await waitForThunkCompletion(thunk)
    } catch {
      // The result map below carries the relay-specific failure detail.
    }

    if (!hasSuccessfulRelay(thunk)) {
      revokeStatus = "idle"
      pushToast({theme: "error", message: `${revokeLabel} failed: ${getPublishError(thunk)}`})
      return
    }

    if (thunk.event) repository.publish(thunk.event as TrustedEvent)
    revokeStatus = "idle"
    pushToast({
      theme: "success",
      message: report.target === "event" ? "Event uncensored." : "Person unbanned.",
    })
    history.back()
  }

  const confirmRevoke = () => {
    pushModal(Confirm, {
      title: revokeLabel,
      subtitle: "Publish a kind:5 delete for this community report.",
      message:
        report.target === "event"
          ? "Remove this event moderation report so the event can render again?"
          : "Remove this person moderation report so their content can render again?",
      confirm: publishReportDelete,
    })
  }

  $effect(() => {
    if (report.target !== "event" || !report.targetEventId || reportRelays.length === 0) return

    const key = `${report.targetEventId}:${reportRelays.join(",")}`
    if (targetEventLoadKey === key) return

    targetEventLoadKey = key
    targetEventLoadStatus = "loading"
    loadCommunityEvents(reportRelays, [{ids: [report.targetEventId]}], {
      authenticate: true,
      timeout: 3000,
    })
      .catch(() => {})
      .finally(() => {
        if (targetEventLoadKey === key) targetEventLoadStatus = "done"
      })
  })
</script>

<article class="rounded-box border border-base-300 bg-base-100 p-3">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-2">
        <strong>{targetLabel} moderation</strong>
        <span class={`badge ${report.target === "event" ? "badge-warning" : "badge-error"}`}
          >{targetLabel}</span>
      </div>
      {#if showReporter}
        <p class="mt-1 text-sm opacity-70">
          Moderator: <ProfileLink pubkey={report.reporterPubkey} />
        </p>
      {/if}
      <p class="mt-1 text-xs opacity-60">
        Published {new Date(report.event.created_at * 1000).toLocaleString()}
      </p>
    </div>

    {#if canRevoke}
      <Button
        class="btn btn-warning btn-sm"
        disabled={revokeStatus === "publishing"}
        onclick={confirmRevoke}>
        {revokeStatus === "publishing" ? "Publishing..." : revokeLabel}
      </Button>
    {:else}
      <p class="max-w-48 text-right text-xs opacity-60">
        Only the reporting moderator can revoke this action.
      </p>
    {/if}
  </div>

  <div class="mt-3 grid gap-2 text-sm md:grid-cols-2">
    <div class="rounded-box bg-base-200 p-3">
      <strong>{report.target === "event" ? "Target author" : "Target person"}</strong>
      <p class="mt-1 opacity-75"><ProfileLink pubkey={report.targetPubkey} /></p>
    </div>

    {#if report.target === "event"}
      <div class="rounded-box bg-base-200 p-3">
        <strong>Section</strong>
        <p class="mt-1 opacity-75">{report.sectionName}</p>
      </div>
      <div class="rounded-box bg-base-200 p-3">
        <strong>Event type</strong>
        <p class="mt-1 opacity-75">
          {targetEventKind}{targetEventKindNumber !== undefined ? ` (${targetEventKindNumber})` : ""}
        </p>
      </div>
      <div class="rounded-box bg-base-200 p-3 md:col-span-2">
        <strong>Event id</strong>
        <p class="mt-1 break-all opacity-75">{report.targetEventId}</p>
      </div>
    {:else}
      <div class="rounded-box bg-base-200 p-3">
        <strong>Scope</strong>
        <p class="mt-1 opacity-75">Community-wide person moderation</p>
      </div>
    {/if}
  </div>

  {#if report.target === "event" && (targetEventTitle || targetEventContent)}
    <details class="mt-3 rounded-box bg-base-200 p-3 text-sm">
      <summary class="cursor-pointer font-semibold">Moderated event content</summary>
      <div class="mt-3 space-y-3">
        {#if targetEventTitle}
          <div>
            <strong class="block text-xs uppercase tracking-wide opacity-60">Title</strong>
            <p class="mt-1 whitespace-pre-wrap opacity-75">{targetEventTitle}</p>
          </div>
        {/if}
        {#if targetEventContent}
          <div>
            <strong class="block text-xs uppercase tracking-wide opacity-60">Content</strong>
            <p class="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words opacity-75">
              {targetEventContent}
            </p>
          </div>
        {/if}
      </div>
    </details>
  {/if}

  {#if report.event.content.trim()}
    <div class="mt-3 rounded-box bg-base-200 p-3 text-sm">
      <strong>Note</strong>
      <p class="mt-1 whitespace-pre-wrap opacity-75">{report.event.content}</p>
    </div>
  {/if}
</article>
