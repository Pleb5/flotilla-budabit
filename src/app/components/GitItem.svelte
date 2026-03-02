<script lang="ts">
  import {nthEq} from "@welshman/lib"
  import {Address, type TrustedEvent} from "@welshman/util"
  import NoteCard from "./NoteCard.svelte"
  import GitActions from "./GitActions.svelte"
  import Link from "@lib/components/Link.svelte"
  import Markdown from "@lib/components/Markdown.svelte"
  import {makeGitPath} from "@lib/budabit"
  import {notifications, hasRepoNotification} from "@app/util/notifications"

  const {
    url,
    event,
    showActivity = true,
    showIssues = true,
    showActions = true,
    hideDate = false
  }: {
    url: string
    event: TrustedEvent
    showActivity?: boolean
    showIssues?: boolean
    showActions?: boolean
    hideDate?: boolean
  } = $props()

  const name = event.tags.find(nthEq(0, "name"))?.[1]
  const description = event.tags.find(nthEq(0, "description"))?.[1]
  const browseHref = $derived.by(() => makeGitPath(url, Address.fromEvent(event).toNaddr()))
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
        return hasRepoNotification($notifications, {relay: url, repoAddress})
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

</script>

<NoteCard event={event} class="card2 sm:card2-sm bg-alt" {hideDate}>
  {#if name}
    <Link href={browseHref} class="block w-full">
      <div class="flex w-full items-center justify-between gap-2">
        <p class="text-xl break-words overflow-wrap-anywhere">{name}</p>
        {#if hasNotifications}
          <span
            class="h-2 w-2 rounded-full bg-primary"
            aria-label="Unread repository updates"
            title="Unread updates"></span>
        {/if}
      </div>
    </Link>
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
