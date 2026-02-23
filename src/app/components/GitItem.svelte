<script lang="ts">
  import {nthEq} from "@welshman/lib"
  import {Address, type TrustedEvent} from "@welshman/util"
  import NoteCard from "./NoteCard.svelte"
  import GitActions from "./GitActions.svelte"
  import Link from "@lib/components/Link.svelte"
  import {makeGitPath} from "@lib/budabit"
  import {notifications} from "@app/util/notifications"

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
  const hasNotifications = $derived.by(
    () => $notifications.has(issuesHref) || $notifications.has(patchesHref),
  )

  // Validate that a string is a valid hex pubkey (exactly 64 hex characters)
  const isValidPubkey = (pubkey: string | undefined | null): boolean => {
    if (!pubkey || typeof pubkey !== 'string') return false;
    return /^[0-9a-f]{64}$/i.test(pubkey);
  }

  // Get maintainers from the event, or fall back to the event author
  const maintainersTag = event.tags.find(nthEq(0, "maintainers"))
  const maintainers = maintainersTag 
    ? maintainersTag.slice(1).filter((pk: string) => isValidPubkey(pk))
    : []
  
  // Use first valid maintainer, or fall back to event author if valid
  const displayPubkey = maintainers.length > 0 && isValidPubkey(maintainers[0])
    ? maintainers[0]
    : event.pubkey
  
  // Create a modified event with the validated pubkey for display
  const displayEvent = displayPubkey ? {...event, pubkey: displayPubkey} : event
</script>

<NoteCard event={displayEvent} class="card2 sm:card2-sm bg-alt" {hideDate}>
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
    <Link href={browseHref} class="block w-full">
      <div class="flex w-full items-start">
        <p class="text-sm break-words overflow-wrap-anywhere">{description}</p>
      </div>
    </Link>
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
