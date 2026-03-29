<script lang="ts">
  import {Address, type EventContent, type TrustedEvent} from "@welshman/util"
  import {
    getFailedThunkUrls,
    mergeThunks,
    repository,
    thunks,
    thunkIsComplete,
    tracker,
  } from "@welshman/app"
  import {PublishStatus} from "@welshman/net"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkFailure from "@app/components/ThunkFailure.svelte"
  import ThunkPending from "@app/components/ThunkPending.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishDelete, publishReaction} from "@app/core/commands"
  import {makeGitIssuePath, makeGitPath} from "@lib/budabit"
  import {deriveIsDeleted} from "@welshman/store"
  import {nthEq} from "@welshman/lib"
  import {sanitizeRelays, buildRepoNaddrFromEvent} from "@nostr-git/core/utils"
  import {buildRepoKey} from "@nostr-git/core/events"
  import {pushToast} from "@app/util/toast"
  import {normalizeRelayUrl} from "@welshman/util"
  import Link from "@lib/components/Link.svelte"
  import { onMount } from "svelte"
  import { parseRepoAnnouncementEvent } from "@nostr-git/core/events"
  import {tokens as tokensStore} from "@nostr-git/ui"
  import {tryTokensForHost, getTokensForHost} from "@nostr-git/ui"
  import {Router} from "@welshman/router"
  import {GIT_RELAYS} from "@lib/budabit/state"

  interface Props {
    url: any
    event: TrustedEvent
    showIssues?: boolean
    showActivity?: boolean
    showPatches?: boolean
    workerApi?: any
  }

  const {url, event, showIssues = true, showActivity = true, showPatches = true, workerApi}: Props = $props()

  const relaysTag = event.tags.find(nthEq(0, "relays")) || []
  const relays = sanitizeRelays(relaysTag.slice(1)) // Skip the "relays" tag name, pass only URLs

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
        fallbackRepoRelays: relays,
        userOutboxRelays,
        gitRelays: GIT_RELAYS,
      }) || Address.fromEvent(event).toNaddr()
    )
  })

  const deleted = deriveIsDeleted(repository, event)
  const thunk = $derived(mergeThunks($thunks.filter(t => t.event.id === event.id)))
  const thunkSuccessCount = $derived.by(() =>
    Object.values($thunk?.results || {}).filter(
      (result: any) => result?.status === PublishStatus.Success,
    ).length,
  )
  const thunkFailedUrls = $derived.by(() => getFailedThunkUrls($thunk))
  const showThunkPending = $derived.by(() => !thunkIsComplete($thunk))
  const showThunkFailure = $derived.by(
    () =>
      thunkIsComplete($thunk) &&
      thunkFailedUrls.length > 0 &&
      thunkSuccessCount === 0 &&
      tracker.getRelays(event.id).size === 0,
  )

  const onPublishDelete = (event: TrustedEvent) =>
    publishDelete({relays: [normalizeRelayUrl(url)], event, protect: false})

  const onPublishReaction = (event: EventContent) => {
    publishReaction({
      event: event as TrustedEvent,
      content: event.content,
      relays: [normalizeRelayUrl(url)],
      protect: false,
    })
  }

  // This might be broken depending on repo owners updating their links or
  // even including one in the first place
  // const web = event.tags.find(nthEq(0, "web"))?.[1]

  let syncStatus: any = $state(null)
  let syncing: boolean = $state(false)
  let repoId: string = $state("")
  let cloneUrls: string[] = $state([])

  onMount(async () => {
    try {
      const announcement = parseRepoAnnouncementEvent(event as any)
      cloneUrls = [...(announcement?.clone || [])]

      const name = announcement?.name || event.tags.find(nthEq(0, "name"))?.[1] || ""
      const owner = event.pubkey || ""
      if (owner && name) {
        repoId = buildRepoKey(owner, name)
      }

      if (!repoId || cloneUrls.length === 0 || !workerApi) return
      syncing = true
      try {
        syncStatus = await workerApi.syncWithRemote({ repoId, cloneUrls })
      } finally {
        syncing = false
      }
    } catch (error) {
      console.debug("[GitActions] Initial repo sync skipped:", error)
    }
  })

  const pullLatest = async () => {
    if (!repoId) return
    if (!workerApi) return
    syncing = true
    try {
      const main = undefined
      await workerApi.resetRepoToRemote({ repoId, branch: main })
      const syncResult = await workerApi.syncWithRemote({ repoId, cloneUrls })
      
      // Handle warnings like CORS issues gracefully
      if (syncResult.warning) {
        console.warn("Sync completed with warning:", syncResult.warning)
        pushToast({ message: "Pulled latest from remote (with limitations)" })
      } else {
        pushToast({ message: "Pulled latest from remote" })
      }
      
      syncStatus = syncResult
    } catch (e) {
      const errorMessage = String(e)
      // Don't show toast for CORS/network errors
      if (!errorMessage.includes('CORS') && 
          !errorMessage.includes('NetworkError') && 
          !errorMessage.includes('Failed to fetch')) {
        pushToast({ message: `Pull failed: ${errorMessage}`, theme: "error" })
      }
    } finally {
      syncing = false
    }
  }

  const pushLocal = async () => {
    if (!repoId || cloneUrls.length === 0) return
    if (!workerApi) return
    const remoteCandidates = Array.from(new Set(cloneUrls.map((url) => String(url || "").trim()).filter(Boolean)))
    syncing = true
    try {
      let pushedTo = ""
      let lastError = ""

      for (const remoteUrl of remoteCandidates) {
        try {
          // Extract hostname for token matching
          let hostname: string
          try {
            if (remoteUrl.startsWith('git@')) {
              const match = remoteUrl.match(/git@([^:]+):/)
              hostname = match ? match[1] : ''
            } else {
              const urlObj = new URL(remoteUrl)
              hostname = urlObj.hostname
            }
          } catch {
            hostname = ''
          }

          const tokens = await tokensStore.waitForInitialization()
          const matchingTokens = getTokensForHost(tokens, (h: string) => h === hostname)

          if (matchingTokens.length > 0) {
            await tryTokensForHost(
              tokens,
              (h: string) => h === hostname,
              async (token: string) => {
                return await workerApi.pushToRemote({ repoId, remoteUrl, token })
              }
            )
          } else {
            await workerApi.pushToRemote({ repoId, remoteUrl })
          }

          pushedTo = remoteUrl
          break
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
        }
      }

      if (!pushedTo) {
        throw new Error(lastError || "Failed to push to all configured clone URLs")
      }

      const syncResult = await workerApi.syncWithRemote({ repoId, cloneUrls })
      
      // Handle warnings like CORS issues gracefully
      if (syncResult.warning) {
        console.warn("Sync completed with warning:", syncResult.warning)
        pushToast({ message: `Pushed local changes to ${pushedTo} (with limitations)` })
      } else {
        pushToast({ message: `Pushed local changes to ${pushedTo}` })
      }
      
      syncStatus = syncResult
    } catch (e) {
      const errorMessage = String(e)
      // Don't show toast for CORS/network errors
      if (!errorMessage.includes('CORS') && 
          !errorMessage.includes('NetworkError') && 
          !errorMessage.includes('Failed to fetch')) {
        pushToast({ message: `Push failed: ${errorMessage}` , theme: "error" })
      }
    } finally {
      syncing = false
    }
  }
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
  <div class="flex flex-grow flex-wrap justify-end gap-2">
    {#if syncStatus && (syncStatus.needsUpdate || (syncStatus.localCommit && syncStatus.headCommit && syncStatus.localCommit !== syncStatus.headCommit))}
      <div class="flex items-center gap-2 rounded-full border border-border bg-muted px-2 py-1 text-xs">
        <span class="opacity-80">Out of sync</span>
        {#if syncStatus.localCommit && syncStatus.headCommit}
          <span class="opacity-60">{syncStatus.localCommit?.slice(0,7)} → {syncStatus.headCommit?.slice(0,7)}</span>
        {/if}
        <button class="btn btn-neutral btn-2xs" disabled={syncing} onclick={pullLatest}>Pull</button>
        <button class="btn btn-primary btn-2xs" disabled={syncing} onclick={pushLocal}>Push</button>
      </div>
    {/if}
    <Link class="cursor-pointer" href={makeGitPath(url, repoNaddr)}>
      <div class="flex-inline btn btn-neutral btn-xs gap-1 rounded-full">Browse</div>
    </Link>
    {#if showIssues}
      <Link class="cursor-pointer" href={makeGitIssuePath(url, repoNaddr)}>
        <div class="flex-inline btn btn-neutral btn-xs gap-1 rounded-full">Issues</div>
      </Link>
    {/if}

    {#if showPatches}
      <Link
        class="cursor-pointer"
        href={makeGitPath(url, repoNaddr) + "/patches"}>
        <div class="flex-inline btn btn-neutral btn-xs gap-1 rounded-full">
          <span>Patches</span>
        </div>
      </Link>
    {/if}
    {#if showActivity}
      <ReactionSummary
        {url}
        {event}
        createReaction={onPublishReaction}
        deleteReaction={onPublishDelete}
        reactionClass="tooltip-left" />
      {#if $deleted}
        <div class="btn btn-error btn-xs rounded-full">Deleted</div>
      {:else if showThunkFailure}
        <ThunkFailure {thunk} />
      {:else if showThunkPending}
        <ThunkPending {thunk} />
      {/if}
      <EventActions {url} {event} noun="Repo" />
    {/if}
  </div>
</div>
