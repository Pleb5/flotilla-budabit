<script lang="ts">
  import {load} from "@welshman/net"
  import {
    Address,
    GIT_ISSUE,
    GIT_PATCH,
    type EventContent,
    type TrustedEvent,
  } from "@welshman/util"
  import {repository} from "@welshman/app"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishDelete, publishReaction} from "@app/core/commands"
  import {makeGitIssuePath, makeGitPath} from "@lib/budabit"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {nthEq} from "@welshman/lib"
  import {goto} from "$app/navigation"
  import * as nip19 from "nostr-tools/nip19"
  import type {AddressPointer} from "nostr-tools/nip19"
  import {canonicalRepoKey, sanitizeRelays} from "@nostr-git/core"
  import {pushToast} from "@app/util/toast"
  import {isRelayUrl, normalizeRelayUrl} from "@welshman/util"
  import Link from "@lib/components/Link.svelte"
  import { onMount } from "svelte"
  import { parseRepoAnnouncementEvent } from "@nostr-git/shared-types"
  import {tokens as tokensStore} from "@nostr-git/ui"
  import {tryTokensForHost, getTokensForHost} from "@nostr-git/ui"

  interface Props {
    url: any
    event: TrustedEvent
    showIssues?: boolean
    showActivity?: boolean
    showPatches?: boolean
    workerApi?: any
  }

  const {url, event, showIssues = true, showActivity = true, showPatches = true, workerApi}: Props = $props()

  let loadingIssues = $state(true)

  const [tagId, ...relays] = sanitizeRelays(event.tags.find(nthEq(0, "relays")) || [])

  const issueFilter = {
    kinds: [GIT_ISSUE],
    "#a": [Address.fromEvent(event).toString()],
  }

  const issues = deriveEventsAsc(deriveEventsById({repository, filters: [issueFilter]}))

  const patchFilter = {
    kinds: [GIT_PATCH],
    "#a": [Address.fromEvent(event).toString()],
  }

  const patches = deriveEventsAsc(deriveEventsById({repository, filters: [patchFilter]}))

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

  $effect(() => {
    if (event) {
      if (showIssues) {
        const cleanRelays = (relays || [])
          .map(u => normalizeRelayUrl(u))
          .filter(u => isRelayUrl(u))

        load({relays: cleanRelays as string[], filters: [issueFilter]}).then(() => {
          loadingIssues = false
        })
      }
    }
  })

  const gotoPatches = async () => {
    const naddr = Address.fromEvent(event).toNaddr()
    try {
      const decoded = nip19.decode(naddr).data as AddressPointer
      const repoId = `${decoded.pubkey}:${decoded.identifier}`
      canonicalRepoKey(repoId)
    } catch (e) {
      pushToast({
        message: `Invalid repository identifier; expected "owner/name" or "owner:name". Cannot open patches until repo is fixed: ${e}`,
        timeout: 7000,
      })
      return
    }
    const destination = makeGitPath(url, naddr) + "/patches"
    goto(destination)
  }

  const gotoRepo = async () => {
    const naddr = Address.fromEvent(event).toNaddr()
    try {
      const decoded = nip19.decode(naddr).data as AddressPointer
      const repoId = `${decoded.pubkey}:${decoded.identifier}`
      canonicalRepoKey(repoId)
    } catch (e) {
      pushToast({
        message: `Invalid repository identifier; expected "owner/name" or "owner:name". Cannot open repo until it is fixed: ${e}`,
        timeout: 7000,
      })
      return
    }
    const destination = makeGitPath(url, naddr)
    goto(destination)
  }

  const gotoIssues = async () => {
    const naddr = Address.fromEvent(event).toNaddr()
    try {
      const decoded = nip19.decode(naddr).data as AddressPointer
      const repoId = `${decoded.pubkey}:${decoded.identifier}`
      canonicalRepoKey(repoId)
    } catch (e) {
      pushToast({
        message: `Invalid repository identifier; expected "owner/name" or "owner:name". Cannot open issues until repo is fixed.`,
        timeout: 7000,
      })
      return
    }
    const destination = makeGitPath(url, naddr) + "/issues"
    goto(destination)
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
        repoId = canonicalRepoKey(`${owner}:${name}`)
      }

      if (!repoId || cloneUrls.length === 0 || !workerApi) return
      syncing = true
      try {
        syncStatus = await workerApi.syncWithRemote({ repoId, cloneUrls })
      } finally {
        syncing = false
      }
    } catch {}
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
    const remoteUrl = cloneUrls[0]
    syncing = true
    try {
      // Extract hostname for token matching
      let hostname: string
      try {
        // Handle SSH URLs like git@github.com:owner/repo.git
        if (remoteUrl.startsWith('git@')) {
          const match = remoteUrl.match(/git@([^:]+):/)
          hostname = match ? match[1] : ''
        } else {
          // Handle HTTPS URLs
          const urlObj = new URL(remoteUrl)
          hostname = urlObj.hostname
        }
      } catch {
        hostname = ''
      }
      const tokens = await tokensStore.waitForInitialization()
      const matchingTokens = getTokensForHost(tokens, (h: string) => h === hostname)

      // Try all tokens for this host until one succeeds, or push without token if none available
      if (matchingTokens.length > 0) {
        await tryTokensForHost(
          tokens,
          (h: string) => h === hostname,
          async (token: string, host: string) => {
            return await workerApi.pushToRemote({ repoId, remoteUrl, token })
          }
        )
      } else {
        // No tokens available - try pushing without authentication (may fail for private repos)
        await workerApi.pushToRemote({ repoId, remoteUrl })
      }

      const syncResult = await workerApi.syncWithRemote({ repoId, cloneUrls })
      
      // Handle warnings like CORS issues gracefully
      if (syncResult.warning) {
        console.warn("Sync completed with warning:", syncResult.warning)
        pushToast({ message: "Pushed local changes to remote (with limitations)" })
      } else {
        pushToast({ message: "Pushed local changes to remote" })
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
    <Link class="cursor-pointer" href={makeGitPath(url, Address.fromEvent(event).toNaddr())}>
      <div class="flex-inline btn btn-neutral btn-xs gap-1 rounded-full">Browse</div>
    </Link>
    {#if showIssues}
      <Link class="cursor-pointer" href={makeGitIssuePath(url, Address.fromEvent(event).toNaddr())}>
        <div class="flex-inline btn btn-neutral btn-xs gap-1 rounded-full">Issues</div>
      </Link>
    {/if}

    {#if showPatches}
      <Link
        class="cursor-pointer"
        href={makeGitPath(url, Address.fromEvent(event).toNaddr()) + "/patches"}>
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
      <ThunkStatusOrDeleted {event} />
      <EventActions {url} {event} noun="Repo" />
    {/if}
  </div>
</div>
