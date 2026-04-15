<script lang="ts">
  import {goto} from "$app/navigation"
  import {nthEq} from "@welshman/lib"
  import {Address, type TrustedEvent} from "@welshman/util"
  import NoteCard from "./NoteCard.svelte"
  import GitActions from "./GitActions.svelte"
  import Link from "@lib/components/Link.svelte"
  import Markdown from "@lib/components/Markdown.svelte"
  import {makeGitPath} from "@lib/budabit"
  import {getInteractiveCardTarget} from "@lib/html"
  import {notifications, hasRepoNotification} from "@app/util/notifications"
  import {Router} from "@welshman/router"
  import {GIT_RELAYS, effectiveRepoAddressesByRepoAddress, getEffectiveRepoAddresses} from "@lib/budabit/state"
  import {buildRepoNaddrFromEvent} from "@nostr-git/core/utils"
  import {Bookmark} from "@lucide/svelte"

  const {
    url,
    event,
    bookmarked = false,
    bookmarkDisabled = false,
    onToggleBookmark,
    tabbable = true,
    showActivity = true,
    showIssues = true,
    showActions = true,
    hideDate = false
  }: {
    url: string
    event: TrustedEvent
    bookmarked?: boolean
    bookmarkDisabled?: boolean
    onToggleBookmark?: () => void
    tabbable?: boolean
    showActivity?: boolean
    showIssues?: boolean
    showActions?: boolean
    hideDate?: boolean
  } = $props()

  const name = event.tags.find(nthEq(0, "name"))?.[1]
  const description = event.tags.find(nthEq(0, "description"))?.[1]
  const repoNaddr = $derived.by(() => {
    const userOutboxRelays = (() => {
      try {
        return Router.get().FromUser().getUrls() || []
      } catch {
        return []
      }
    })()

    return (
      buildRepoNaddrFromEvent({
        event,
        fallbackPubkey: event.pubkey,
        userOutboxRelays,
        gitRelays: GIT_RELAYS,
      }) || Address.fromEvent(event).toNaddr()
    )
  })
  const browseHref = $derived.by(() => makeGitPath(url, repoNaddr))
  const issuesHref = $derived.by(() => `${browseHref}/issues`)
  const patchesHref = $derived.by(() => `${browseHref}/patches`)
  const repoAddress = $derived.by(() => {
    try {
      return Address.fromEvent(event).toString()
    } catch {
      return ""
    }
  })
  const hasNotifications = $derived.by(
    () => {
      if (repoAddress) {
        return hasRepoNotification($notifications, {
          relay: url,
          repoAddress,
          repoAddresses: getEffectiveRepoAddresses($effectiveRepoAddressesByRepoAddress, repoAddress),
        })
      }
      return $notifications.has(issuesHref) || $notifications.has(patchesHref)
    },
  )

  const getLinkRanges = (text: string) => {
    const ranges: Array<{start: number; end: number}> = []
    const patterns = [
      /\[[^\]]+\]\([^)]+\)/g,
      /<https?:\/\/[^>\s]+>/g,
      /(?:https?:\/\/|www\.)[^\s<>()]+/g,
    ]

    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text))) {
        ranges.push({start: match.index, end: match.index + match[0].length})
      }
    }

    if (ranges.length < 2) return ranges

    ranges.sort((a, b) => a.start - b.start)
    const merged: Array<{start: number; end: number}> = [ranges[0]]

    for (const range of ranges.slice(1)) {
      const last = merged[merged.length - 1]
      if (range.start <= last.end) {
        last.end = Math.max(last.end, range.end)
      } else {
        merged.push({...range})
      }
    }

    return merged
  }

  const truncateDescription = (text: string, max = 300) => {
    if (!text) return ""
    if (text.length <= max) return text

    const ranges = getLinkRanges(text)
    let cut = max
    const crossing = ranges.find(range => range.start < cut && range.end > cut)
    if (crossing) {
      cut = crossing.start
    }

    const truncated = text.slice(0, cut).trimEnd()
    return truncated ? `${truncated}...` : "..."
  }

  const descriptionPreview = $derived.by(() => truncateDescription(description || ""))

  const navigateToRepo = () => void goto(browseHref)

  const handleCardClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (getInteractiveCardTarget(event.target, event.currentTarget)) return

    event.stopPropagation()
    navigateToRepo()
  }

  const handleCardKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    if (getInteractiveCardTarget(event.target, event.currentTarget)) return

    event.preventDefault()
    event.stopPropagation()
    navigateToRepo()
  }

</script>

{#snippet cardContent()}
  <NoteCard event={event} class="card2 sm:card2-sm bg-alt" {hideDate}>
    {#if name}
      <div class="flex w-full items-start justify-between gap-2">
        <Link href={browseHref} class="block min-w-0 flex-1">
          <div class="flex w-full items-center gap-2">
            <p class="text-xl break-words overflow-wrap-anywhere">{name}</p>
          </div>
        </Link>
        <div class="flex items-center gap-2">
          {#if onToggleBookmark}
            <button
              type="button"
              class={`rounded-full border p-1.5 transition-colors ${
                bookmarked
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background/80 text-muted-foreground hover:text-foreground"
              }`}
              onclick={onToggleBookmark}
              disabled={bookmarkDisabled}
              aria-label={bookmarked ? "Remove bookmark" : "Bookmark repository"}
              title={bookmarked ? "Remove bookmark" : "Bookmark repository"}>
              <Bookmark class={`h-4 w-4 ${bookmarked ? "fill-current" : ""}`} />
            </button>
          {/if}
          {#if hasNotifications}
            <span
              class="h-2 w-2 rounded-full bg-primary"
              aria-label="Unread repository updates"
              title="Unread updates"></span>
          {/if}
        </div>
      </div>
    {:else}
      <p class="mb-3 h-0 text-xs opacity-75">
        Name missing!
      </p>
    {/if}
    {#if description}
      <div class="flex w-full items-start">
        <Markdown content={descriptionPreview} {event} {url} variant="comment" />
      </div>
    {:else}
      <p class="mb-3 h-0 text-xs opacity-75">
        Description missing!
      </p>
    {/if}
    {#if showActions}
      <div class="flex w-full flex-col items-end justify-between gap-2 sm:flex-row">
        <GitActions {showActivity} {showIssues} {url} {event} />
      </div>
    {/if}
  </NoteCard>
{/snippet}

{#if tabbable}
  <div
    class="w-full"
    role="link"
    tabindex="0"
    aria-label={name ? `Open repository ${name}` : "Open repository"}
    onclick={handleCardClick}
    onkeydown={handleCardKeydown}>
    {@render cardContent()}
  </div>
{:else}
  <div class="w-full">
    {@render cardContent()}
  </div>
{/if}
