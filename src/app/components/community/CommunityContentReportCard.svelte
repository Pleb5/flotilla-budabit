<script lang="ts">
  import DateTimeDisplay from "@lib/components/DateTimeDisplay.svelte"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {
    COMMENT,
    EVENT_DATE,
    EVENT_TIME,
    MESSAGE,
    NOTE,
    THREAD,
    ZAP_GOAL,
    getIdFilters,
    getTagValue,
    makeEvent,
    type TrustedEvent,
  } from "@welshman/util"
  import {pubkey, repository} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import Link from "@lib/components/Link.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import PublicationStatus from "@app/components/PublicationStatus.svelte"
  import {
    activeExactCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    loadCommunityEvents,
  } from "@app/core/community-state"
  import {TARGETED_PUBLICATION_KIND, normalizePubkey} from "@app/core/community"
  import {getCommunityScopedPublishRelays} from "@app/core/community-relays"
  import {publicationOperations, startPublication} from "@app/core/publication-operations"
  import {getReportReviewSemanticKey} from "@app/core/governance-publication-operations"
  import {
    canReviewCommunityContentReport,
    makeCommunityReportReviewLabel,
    type CommunityContentReportGroup,
  } from "@app/core/community-reports"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {getCommunityEventPath, getExactCommunityReportTargetPath} from "@app/util/routes"

  type Props = {
    group: CommunityContentReportGroup
    relays?: string[]
  }

  const {group, relays = []}: Props = $props()

  let reviewStatus = $state<"idle" | "publishing">("idle")
  let targetEventLoadStatus = $state<"idle" | "loading" | "done">("idle")
  let targetEventLoadKey = ""

  const currentPubkey = $derived(normalizePubkey($pubkey || ""))
  const reportRelays = $derived(getCommunityScopedPublishRelays($activeExactCommunityDefinition))
  const profileRelays = $derived(relays.length > 0 ? relays : reportRelays)
  const pendingReports = $derived(group.reports.filter(report => !report.reviewed))
  const reviewablePendingReports = $derived.by(() =>
    $activeExactCommunityDefinition
      ? pendingReports.filter(report =>
          canReviewCommunityContentReport({
            definition: $activeExactCommunityDefinition!,
            reviewerPubkey: currentPubkey,
            report,
            profileListEvents: $activeCommunityProfileListEvents,
            reportState: $activeCommunityReportState,
          }),
        )
      : [],
  )
  const reportOperationIds = $derived.by(() => {
    const operationIds = new Map<string, string>()

    for (const report of reviewablePendingReports) {
      const semanticKey = getReportReviewSemanticKey(report.event.id)
      const operation = Array.from($publicationOperations.values()).find(
        candidate =>
          candidate.ownerPubkey === currentPubkey &&
          candidate.semanticKey === semanticKey &&
          (candidate.phase === "publishing" || candidate.phase === "unconfirmed"),
      )

      if (operation) operationIds.set(report.event.id, operation.operationId)
    }

    return operationIds
  })
  const startablePendingReports = $derived(
    reviewablePendingReports.filter(report => !reportOperationIds.has(report.event.id)),
  )
  const canReview = $derived(
    Boolean(currentPubkey && reportRelays.length > 0 && startablePendingReports.length > 0),
  )
  const latestReview = $derived(
    group.reviews.toSorted(
      (a, b) => b.event.created_at - a.event.created_at || a.event.id.localeCompare(b.event.id),
    )[0],
  )

  const targetEventFilters = $derived(
    group.targetAddress
      ? getIdFilters([group.targetAddress])
      : group.targetEventId
        ? [{ids: [group.targetEventId]}]
        : [{ids: [""]}],
  )
  const targetEvents = $derived(
    deriveEventsAsc(
      deriveEventsById({repository, filters: targetEventFilters, includeDeleted: true}),
    ),
  )
  const targetEvent = $derived($targetEvents[0])
  const targetEventKindNumber = $derived(targetEvent?.kind ?? group.targetEventKind)
  const targetEventTitle = $derived(
    targetEvent
      ? (getTagValue("title", targetEvent.tags) || "").trim()
      : group.reports.find(report => report.targetEventTitle)?.targetEventTitle || "",
  )
  const targetEventContent = $derived(
    targetEvent?.content?.trim() ||
      group.reports.find(report => report.targetEventContent)?.targetEventContent ||
      "",
  )
  const targetPath = $derived.by(() => {
    if (!$activeExactCommunityDefinition) return undefined

    return (
      (targetEvent ? getCommunityEventPath(targetEvent) : undefined) ||
      getExactCommunityReportTargetPath($activeExactCommunityDefinition.pointer, group)
    )
  })

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

  const targetEventKind = $derived.by(() => {
    if (!targetEvent) {
      if (group.targetEventKind !== undefined) {
        return getTargetEventKindLabelFromParts(group.targetEventKind, group.targetEventSubtype)
      }

      return targetEventLoadStatus === "done" || reportRelays.length === 0
        ? "Event unavailable"
        : "Loading event..."
    }

    return getTargetEventKindLabel(targetEvent)
  })

  const publishReviewedLabels = () => {
    if (!$activeExactCommunityDefinition || !canReview || reviewStatus === "publishing") return

    if (reportRelays.length === 0) {
      pushToast({theme: "error", message: "Community definition must declare at least one relay."})
      return
    }

    reviewStatus = "publishing"
    let started = 0
    let startError: unknown

    for (const report of startablePendingReports) {
      try {
        const template = makeCommunityReportReviewLabel({
          community: report.community,
          reportId: report.event.id,
          targetEventId: report.targetEventId,
          targetEventKind: report.targetEventKind,
          sectionName: report.sectionName,
          reporterPubkey: report.reporterPubkey,
        })

        startPublication({
          relays: reportRelays,
          event: makeEvent(template.kind, template),
          label: "Report review label",
          href: targetPath,
          semanticKey: getReportReviewSemanticKey(report.event.id),
          preview: "none",
        })
        started += 1
      } catch (error) {
        startError ||= error
      }
    }

    reviewStatus = "idle"
    if (startError) {
      pushToast({
        theme: "error",
        message:
          startError instanceof Error ? startError.message : "Failed to start a report review.",
      })
    }

    if (started > 0) history.back()
  }

  const confirmReviewed = () => {
    const count = startablePendingReports.length

    pushModal(Confirm, {
      title: count === 1 ? "Mark report reviewed" : "Mark reports reviewed",
      message: `Mark ${count} pending report${count === 1 ? "" : "s"} as reviewed?`,
      confirm: publishReviewedLabels,
    })
  }

  $effect(() => {
    if ((!group.targetAddress && !group.targetEventId) || reportRelays.length === 0) return

    const targetRef = group.targetAddress || group.targetEventId || ""
    const key = `${targetRef}:${reportRelays.join(",")}`
    if (targetEventLoadKey === key) return

    targetEventLoadKey = key
    targetEventLoadStatus = "loading"
    loadCommunityEvents(
      reportRelays,
      group.targetAddress ? getIdFilters([group.targetAddress]) : [{ids: [group.targetEventId!]}],
      {
        authenticate: true,
        timeout: 3000,
      },
    )
      .catch(() => {})
      .finally(() => {
        if (targetEventLoadKey === key) targetEventLoadStatus = "done"
      })
  })
</script>

<article
  class={`rounded-box border border-base-300 bg-base-100 p-3 ${group.reviewed ? "" : "border-warning bg-warning/10"}`}>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-2">
        <strong>Content report</strong>
        <span class={`badge ${group.reviewed ? "badge-success" : "badge-warning"}`}>
          {group.reviewed ? "Reviewed" : "Pending"}
        </span>
        <span class="badge badge-neutral">
          {group.reports.length}
          {group.reports.length === 1 ? "report" : "reports"}
        </span>
      </div>
      <p class="mt-1 text-xs opacity-60">
        Latest report <DateTimeDisplay value={group.latestCreatedAt * 1000} options={{showTimeZone: true}} />
      </p>
      {#if latestReview}
        <p class="mt-1 text-xs opacity-70">
          Reviewed by <ProfileLink pubkey={latestReview.reviewerPubkey} relays={profileRelays} /> on <DateTimeDisplay value={latestReview.event.created_at * 1000} options={{showTimeZone: true}} />
        </p>
      {/if}
    </div>

    <div class="flex flex-wrap justify-end gap-2">
      {#if targetPath}
        <Link class="btn btn-neutral btn-sm" href={targetPath}>Open context</Link>
      {/if}
      {#if !group.reviewed}
        <Button
          class="btn btn-primary btn-sm"
          disabled={!canReview || reviewStatus === "publishing"}
          onclick={confirmReviewed}>
          {reviewStatus === "publishing" ? "Publishing..." : "Mark Reviewed"}
        </Button>
      {/if}
    </div>
  </div>

  {#each Array.from(new Set(reportOperationIds.values())) as operationId (operationId)}
    <PublicationStatus {operationId} class="mt-3" />
  {/each}

  <div class="mt-3 grid gap-2 text-sm md:grid-cols-2">
    <div class="rounded-box bg-base-200 p-3">
      <strong>Target author</strong>
      <p class="mt-1 opacity-75">
        <ProfileLink pubkey={group.targetPubkey} relays={profileRelays} />
      </p>
    </div>
    <div class="rounded-box bg-base-200 p-3">
      <strong>Section</strong>
      <p class="mt-1 opacity-75">{group.sectionName}</p>
    </div>
    <div class="rounded-box bg-base-200 p-3">
      <strong>Event type</strong>
      <p class="mt-1 opacity-75">
        {targetEventKind}{targetEventKindNumber !== undefined ? ` (${targetEventKindNumber})` : ""}
      </p>
    </div>
    <div class="rounded-box bg-base-200 p-3">
      <strong>Event id</strong>
      <p class="mt-1 break-all opacity-75">{group.targetEventId}</p>
    </div>
  </div>

  {#if targetEventTitle || targetEventContent}
    <details class="mt-3 rounded-box bg-base-200 p-3 text-sm">
      <summary class="cursor-pointer font-semibold">Reported event content</summary>
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

  <details class="mt-3 rounded-box bg-base-200 p-3 text-sm" open={!group.reviewed}>
    <summary class="cursor-pointer font-semibold">Reporter details</summary>
    <div class="mt-3 flex flex-col gap-2">
      {#each group.reports as report (report.event.id)}
        <div class="rounded-box bg-base-100 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p>
              Reporter: <ProfileLink pubkey={report.reporterPubkey} relays={profileRelays} />
            </p>
            <span class={`badge ${report.reviewed ? "badge-success" : "badge-warning"}`}>
              {report.reviewed ? "Reviewed" : "Pending"}
            </span>
          </div>
          <p class="mt-1 text-xs opacity-60">
            Published <DateTimeDisplay value={report.event.created_at * 1000} options={{style: "full", showTimeZone: true}} />
          </p>
          {#if report.event.content.trim()}
            <p class="mt-2 whitespace-pre-wrap opacity-75">{report.event.content}</p>
          {/if}
        </div>
      {/each}
    </div>
  </details>
</article>
