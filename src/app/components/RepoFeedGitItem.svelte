<script lang="ts">
  import {displayProfileByPubkey, thunks} from "@welshman/app"
  import {getTag, type EventContent, type TrustedEvent} from "@welshman/util"
  import {
    parseIssueEvent,
    parsePullRequestEvent,
    GIT_PULL_REQUEST,
    GIT_ISSUE,
  } from "@nostr-git/core/events"
  import {CircleCheck, CircleDot, FileCode, ArrowUpRight, XCircle} from "@lucide/svelte"
  import {goto} from "$app/navigation"
  import ShareCircle from "@assets/icons/share-circle.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ChannelMessageEmojiButton from "@app/components/ChannelMessageEmojiButton.svelte"
  import RepoFeedGitItemMenuMobile from "@app/components/RepoFeedGitItemMenuMobile.svelte"
  import RepoActivityThreadCreate from "@app/components/RepoActivityThreadCreate.svelte"
  import ThunkFailure from "@app/components/ThunkFailure.svelte"
  import {getInteractiveCardTarget} from "@lib/html"
  import {publishReaction, publishSocialDelete} from "@app/core/commands"
  import {COMMUNITY_SECTION_THREADS} from "@app/core/community"
  import {activeUserCommunityRefs} from "@app/core/community-state"
  import {makeEventShareEntityForEvent} from "@app/util/event-share"
  import {clip} from "@app/util/toast"
  import {pushModal} from "@app/util/modal"

  type RepoFeedStatusState = "open" | "draft" | "closed" | "applied"

  interface Props {
    url: string
    event: TrustedEvent
    openHref: string
    interactionRelays?: string[]
    scopeH?: string
    statusState?: RepoFeedStatusState
    defaultThreadCommunityPubkey?: string
  }

  const {
    url,
    event,
    openHref,
    interactionRelays = [],
    scopeH = "",
    statusState = "open",
    defaultThreadCommunityPubkey = "",
  }: Props = $props()

  const thunk = $derived($thunks.find(t => t.event.id === event.id))
  const relayTargets = $derived.by(() =>
    (interactionRelays.length > 0 ? interactionRelays : [url]).filter(Boolean),
  )
  const canCreateThread = $derived.by(() =>
    $activeUserCommunityRefs.some(ref => ref.writableSections.includes(COMMUNITY_SECTION_THREADS)),
  )
  const scopedTags = $derived.by(() => {
    if (!scopeH || getTag("h", event.tags)?.[1] === scopeH) {
      return [] as string[][]
    }

    return [["h", scopeH]]
  })

  const parsedContent = $derived.by(() => {
    if (event.kind === GIT_ISSUE) {
      const parsed = parseIssueEvent(event as any)

      return {
        title: parsed.subject || "Untitled issue",
        body: parsed.content || "",
        kindLabel: "Issue",
      }
    }

    if (event.kind === GIT_PULL_REQUEST) {
      const parsed = parsePullRequestEvent(event as any)

      return {
        title: parsed.subject || "Untitled pull request",
        body: parsed.content || "",
        kindLabel: "Pull request",
      }
    }

    return {
      title: "Untitled item",
      body: event.content || "",
      kindLabel: "Item",
    }
  })

  const authorDisplay = $derived.by(() => displayProfileByPubkey(event.pubkey))
  const bodyPreview = $derived.by(() => parsedContent.body.replace(/\s+/g, " ").trim())

  const statusInfo = $derived.by(() => {
    switch (statusState) {
      case "applied":
        return {
          icon: CircleCheck,
          iconClass: "text-sky-300",
          labelClass: "text-sky-300",
          badgeClass: "border-sky-500/30 bg-sky-500/10 text-sky-300",
          label: event.kind === GIT_ISSUE ? "Resolved" : "Merged",
        }
      case "closed":
        return {
          icon: XCircle,
          iconClass: "text-rose-300",
          labelClass: "text-rose-300",
          badgeClass: "border-rose-500/30 bg-rose-500/10 text-rose-300",
          label: "Closed",
        }
      case "draft":
        return {
          icon: FileCode,
          iconClass: "text-amber-300",
          labelClass: "text-amber-300",
          badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-300",
          label: "Draft",
        }
      default:
        return {
          icon: CircleDot,
          iconClass: "text-emerald-300",
          labelClass: "text-emerald-300",
          badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
          label: "Open",
        }
    }
  })

  const openLabel = $derived.by(() => {
    if (event.kind === GIT_ISSUE) return "Open issue"
    if (event.kind === GIT_PULL_REQUEST) return "Open pull request"
    return "Open item"
  })

  const openActionsMenu = () =>
    pushModal(RepoFeedGitItemMenuMobile, {
      url,
      event,
      openHref,
      openLabel,
      relays: relayTargets,
      defaultThreadCommunityPubkey,
    })

  const handleCardClick = (event: MouseEvent) => {
    if (getInteractiveCardTarget(event.target, event.currentTarget)) {
      return
    }

    openActionsMenu()
  }

  const handleCardKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    if (getInteractiveCardTarget(event.target, event.currentTarget)) return

    event.preventDefault()
    openActionsMenu()
  }

  const openItem = () => goto(openHref)

  const shareItem = (domEvent?: Event) => {
    domEvent?.stopPropagation()
    clip(makeEventShareEntityForEvent(event, {url, relays: relayTargets}))
  }

  const createThread = (domEvent?: Event) => {
    domEvent?.stopPropagation()
    if (!canCreateThread) return

    pushModal(RepoActivityThreadCreate, {
      event,
      url,
      relays: relayTargets,
      defaultCommunityPubkey: defaultThreadCommunityPubkey,
    })
  }

  const deleteReaction = async (event: TrustedEvent) =>
    publishSocialDelete({
      url,
      relays: relayTargets,
      event,
    })

  const createReaction = async (template: EventContent) =>
    publishReaction({
      ...template,
      event,
      relays: relayTargets,
      tags: [...(template.tags || []), ...scopedTags],
    })
</script>

<div
  data-event={event.id}
  role="button"
  tabindex="0"
  class="group block cursor-pointer p-2 text-left"
  onclick={handleCardClick}
  onkeydown={handleCardKeydown}>
  <div
    class="rounded-2xl border border-border bg-base-200/60 p-4 shadow-sm transition-colors hover:bg-base-200/80">
    <div class="flex items-start gap-3">
      <statusInfo.icon class={`mt-1 h-5 w-5 shrink-0 ${statusInfo.iconClass}`} />

      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <span
              class="rounded-full bg-base-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {parsedContent.kindLabel}
            </span>
            <span
              class={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusInfo.badgeClass}`}>
              {statusInfo.label}
            </span>
          </div>

          <div
            class="flex shrink-0 items-center gap-1 rounded-full border border-neutral bg-base-100/90 p-1">
            <ChannelMessageEmojiButton
              {url}
              {event}
              relays={relayTargets}
              {scopeH} />
            <Button
              class="btn btn-xs"
              onclick={shareItem}
              data-stop-tap
              aria-label="Share activity"
              title="Share activity">
              <Icon icon={ShareCircle} size={4} />
            </Button>
            <Button
              class="btn btn-xs"
              onclick={createThread}
              data-stop-tap
              disabled={!canCreateThread}
              aria-label="Create thread from activity"
              title={canCreateThread
                ? "Create thread from activity"
                : "No thread-writable community available"}>
              <Icon icon={NotesMinimalistic} size={4} />
            </Button>
          </div>
        </div>

        <h3
          class="mt-2 line-clamp-4 break-words text-base font-semibold leading-tight text-foreground">
          {parsedContent.title}
        </h3>

        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>By @{authorDisplay}</span>
          <span>•</span>
          <span>{new Date(event.created_at * 1000).toLocaleDateString()}</span>
        </div>

        {#if bodyPreview}
          <p class="mt-3 line-clamp-3 break-words text-sm text-muted-foreground">
            {bodyPreview}
          </p>
        {/if}

        {#if thunk}
          <ThunkFailure showToastOnRetry {thunk} class="mt-3" />
        {/if}
      </div>
    </div>

    <div class="mt-4 flex items-center justify-between gap-2">
      <ReactionSummary
        {url}
        relays={relayTargets}
        {scopeH}
        {event}
        {deleteReaction}
        {createReaction}
        reactionClass="tooltip-left" />

      <Button class="btn btn-ghost btn-xs gap-1" onclick={openItem} data-stop-tap>
        <ArrowUpRight class="h-4 w-4" />
        <span>Open</span>
      </Button>
    </div>
  </div>
</div>
