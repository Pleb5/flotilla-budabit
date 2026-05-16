<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {makeEvent} from "@welshman/util"
  import {pubkey, publishThunk, repository, waitForThunkCompletion} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {activeCommunityRelays} from "@app/core/community-state"
  import {normalizePubkey} from "@app/core/community"
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

  const currentPubkey = $derived(normalizePubkey($pubkey || ""))
  const reportRelays = $derived(
    (relays.length > 0 ? relays : $activeCommunityRelays).filter(Boolean),
  )
  const canRevoke = $derived(Boolean(currentPubkey && report.reporterPubkey === currentPubkey))
  const revokeLabel = $derived(report.target === "event" ? "Uncensor" : "Unban")
  const targetLabel = $derived(report.target === "event" ? "Event" : "Person")

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

  {#if report.event.content.trim()}
    <div class="mt-3 rounded-box bg-base-200 p-3 text-sm">
      <strong>Note</strong>
      <p class="mt-1 whitespace-pre-wrap opacity-75">{report.event.content}</p>
    </div>
  {/if}
</article>
