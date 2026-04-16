<script lang="ts">
  import {displayProfileByPubkey, thunks} from "@welshman/app"
  import {getTag, type EventContent, type TrustedEvent} from "@welshman/util"
  import {parseIssueEvent, parsePullRequestEvent, GIT_PULL_REQUEST, GIT_ISSUE} from "@nostr-git/core/events"
  import {parseGitPatchFromEvent} from "@nostr-git/core/git"
  import {CircleCheck, CircleDot, FileCode, ArrowUpRight, XCircle} from "@lucide/svelte"
  import {goto} from "$app/navigation"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ChannelMessageEmojiButton from "@app/components/ChannelMessageEmojiButton.svelte"
  import RepoFeedGitItemMenuMobile from "@app/components/RepoFeedGitItemMenuMobile.svelte"
  import ThunkFailure from "@app/components/ThunkFailure.svelte"
  import {getInteractiveCardTarget} from "@lib/html"
  import {publishReaction, publishSocialDelete} from "@app/core/commands"
  import {pushModal} from "@app/util/modal"

  type RepoFeedStatusState = "open" | "draft" | "closed" | "applied"

  interface Props {
    url: string
    event: TrustedEvent
    openHref: string
    replyTo?: (event: TrustedEvent) => void
    interactionRelays?: string[]
    scopeH?: string
    statusState?: RepoFeedStatusState
  }

  const {
    url,
    event,
    openHref,
    replyTo = undefined,
    interactionRelays = [],
    scopeH = "",
    statusState = "open",
  }: Props = $props()

  const thunk = $derived($thunks.find(t => t.event.id === event.id))
  const reply = replyTo ? () => replyTo(event) : undefined
  const relayTargets = $derived.by(() => (interactionRelays.length > 0 ? interactionRelays : [url]).filter(Boolean))
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

    const parsed = parseGitPatchFromEvent(event as any)

    return {
      title: parsed.title || "Untitled patch",
      body: parsed.description || "",
      kindLabel: "Patch",
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
          label: event.kind === GIT_ISSUE ? "Resolved" : event.kind === GIT_PULL_REQUEST ? "Merged" : "Applied",
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
    return "Open patch"
  })

  const openActionsMenu = () =>
    pushModal(RepoFeedGitItemMenuMobile, {
      url,
      event,
      openHref,
      openLabel,
      reply,
      relays: relayTargets,
      scopeH,
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

  const deleteReaction = async (event: TrustedEvent) =>
    publishSocialDelete({
      url,
      relays: relayTargets,
      event,
      protect: false,
    })

  const createReaction = async (template: EventContent) =>
    publishReaction({
      ...template,
      event,
      relays: relayTargets,
      tags: [...(template.tags || []), ...scopedTags],
      protect: false,
    })
</script>

<div
  data-event={event.id}
  role="button"
  tabindex="0"
  class="group block cursor-pointer p-2 text-left"
  onclick={handleCardClick}
  onkeydown={handleCardKeydown}>
  <div class="rounded-2xl border border-border bg-base-200/60 p-4 shadow-sm transition-colors hover:bg-base-200/80">
    <div class="flex items-start gap-3">
      <statusInfo.icon class={`mt-1 h-5 w-5 shrink-0 ${statusInfo.iconClass}`} />

      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <span class="rounded-full bg-base-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {parsedContent.kindLabel}
            </span>
            <span class={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusInfo.badgeClass}`}>
              {statusInfo.label}
            </span>
          </div>

          <div class="flex shrink-0 items-center gap-1 rounded-full border border-neutral bg-base-100/90 p-1">
      <ChannelMessageEmojiButton {url} {event} relays={relayTargets} {scopeH} protect={false} />
      {#if reply}
        <Button class="btn join-item btn-xs" onclick={reply} data-stop-tap>
          <Icon icon={Reply} size={4} />
        </Button>
      {/if}
          </div>
        </div>

        <h3 class="mt-2 line-clamp-4 break-words text-base font-semibold leading-tight text-foreground">
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
