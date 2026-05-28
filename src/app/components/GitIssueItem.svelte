<script lang="ts">
  import {page} from "$app/stores"
  import {
    getListTags,
    getPubkeyTagValues,
    getTag,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import {userMuteList} from "@welshman/app"
  import {formatTimestampRelative} from "@welshman/lib"
  import {load, request} from "@welshman/net"
  import {now, nthEq, sortBy} from "@welshman/lib"
  import {GIT_REPO_ANNOUNCEMENT, GitIssueStatus} from "@nostr-git/core/events"
  import NoteCard from "./NoteCard.svelte"
  import Content from "@app/components/Content.svelte"
  import {nip19} from "nostr-tools"
  import Link from "@src/lib/components/Link.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import {onMount} from "svelte"
  import {pushModal} from "@app/util/modal"
  import ThreadCreate from "./ThreadCreate.svelte"
  import {decodeRelay} from "@app/core/state"
  import {getRepoMaintainers} from "@app/core/git-state"
  import {Router} from "@welshman/router"
  import {isImportedEvent, resolveIssueStatus} from "@nostr-git/core/events"
  import {deriveEffectiveLabels} from "@app/core/git-state"

  const {
    issue,
    latestStatus = undefined,
    fetchRepoAndStatus = false,
    showThreadAction = false,
  }: {
    issue: TrustedEvent
    latestStatus?: TrustedEvent | undefined
    fetchRepoAndStatus?: boolean
    showThreadAction?: boolean
  } = $props()

  const url = decodeRelay($page.params.relay)

  const aTag = getTag("a", issue.tags) as string[]
  const address = aTag[1]
  const pubkey = address.split(":")[1]
  const relayHint = aTag[2]

  const repoNpub = nip19.npubEncode(pubkey)
  const repoDtag = address.split(":")[2]
  const repoLink = `https://gitworkshop.dev/${repoNpub}/${repoDtag}`

  const backupRelays = [...Router.get().FromPubkey(pubkey!).getUrls()]

  let queryRelays = relayHint ? [relayHint] : backupRelays

  const subject = issue.tags.find(nthEq(0, "subject"))?.[1] || ""
  const issueLink = `${repoLink}/issues/${nip19.noteEncode(issue.id)}`

  const lastActive = $derived(latestStatus?.created_at ?? issue.created_at)

  const mutedPubkeys = getPubkeyTagValues(getListTags($userMuteList))

  let statusColor = $state("badge-success")
  let displayedStatus = $state(GitIssueStatus.OPEN)
  // Accumulated status events and the resolved final status.
  let statusEvents: TrustedEvent[] = $state([])
  let finalStatus: TrustedEvent | undefined = $state(undefined)
  let finalReason: string | undefined = $state(undefined)
  let didResolveStatus = $state(false)
  let maintainersSet: Set<string> = $state(new Set<string>())
  let repoOwnerPubkey = $state("")
  // NIP-32 labels (centralized derivation)
  let labelsNormalized: string[] = $state([])

  $effect(() => {
    const s = finalStatus ?? (didResolveStatus ? undefined : latestStatus)
    if (!s) {
      statusColor = "badge-success"
      displayedStatus = GitIssueStatus.OPEN
      return
    }

    switch (s.kind) {
      case GIT_STATUS_OPEN:
        statusColor = "badge-success"
        displayedStatus = GitIssueStatus.OPEN
        break
      case GIT_STATUS_CLOSED:
        statusColor = "badge-error"
        displayedStatus = GitIssueStatus.CLOSED
        break
      case GIT_STATUS_COMPLETE:
        statusColor = "badge-info"
        displayedStatus = GitIssueStatus.RESOLVED
        break
      case GIT_STATUS_DRAFT:
        statusColor = "badge-warning"
        displayedStatus = GitIssueStatus.DRAFT
        break
    }
  })

  const controller = new AbortController()

  const recomputeFinalStatus = () => {
    try {
      if (statusEvents.length === 0) {
        finalStatus = undefined
        finalReason = undefined
        didResolveStatus = false
        return
      }
      const res: any = resolveIssueStatus(
        {root: issue as any, comments: [], statuses: statusEvents as any},
        issue.pubkey,
        maintainersSet,
        {repoOwner: repoOwnerPubkey, importedRoot: isImportedEvent(issue as any)},
      )
      finalStatus = res.final as any
      finalReason = res.reason as string
      didResolveStatus = true
    } catch (e) {
      // Non-fatal; keep fallback behavior
      finalStatus = undefined
      finalReason = undefined
      didResolveStatus = false
    }
  }

  const loadRepoAndStatus = async () => {
    if (aTag && aTag.length > 0) {
      const repoFilter = {
        kinds: [GIT_REPO_ANNOUNCEMENT],
        authors: [pubkey!],
        "#d": [repoDtag],
      }

      const events = await load({
        relays: queryRelays,
        filters: [repoFilter],
      })

      if (events.length > 0) {
        const repoEvent = events[0]
        maintainersSet = new Set(getRepoMaintainers(repoEvent as any))
        repoOwnerPubkey = repoEvent.pubkey || ""

        const [tagId, ...relays] = getTag("relays", repoEvent.tags) ?? []

        queryRelays = backupRelays
        if (relays.length > 0) {
          queryRelays = relays
        } else if (relayHint) {
          queryRelays = [relayHint]
        }

        const statusFilter: Filter = {
          kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
          "#e": [issue.id],
        }

        const statuses = await load({
          relays: queryRelays,
          filters: [statusFilter],
        })

        statusEvents = statuses
        // Compute effective status from all fetched statuses
        recomputeFinalStatus()

        // Derive labels via shared store helper
        try {
          const eff = deriveEffectiveLabels(issue.id).get()
          const flat = eff ? Array.from((eff as any).flat ?? []) : []
          // Convert to display-friendly labels (drop namespace like 't/' or 'ugc/')
          labelsNormalized = flat.map(v => {
            const s = String(v)
            const idx = s.lastIndexOf("/")
            return idx >= 0 ? s.slice(idx + 1) : s.replace(/^#/, "")
          })
        } catch {}

        statusFilter.since = now()
        request({
          signal: controller.signal,
          relays: queryRelays,
          filters: [statusFilter],
          onEvent: (status: TrustedEvent) => {
            // dedupe by id and append
            if (!statusEvents.find(s => s.id === status.id)) {
              statusEvents = [...statusEvents, status]
              recomputeFinalStatus()
            }
          },
        })
        // Live updates are handled by deriveEffectiveLabels' internal subscriptions
      }
    }
  }

  const startThread = () => pushModal(ThreadCreate, {url})

  onMount(() => {
    if (fetchRepoAndStatus) {
      loadRepoAndStatus()
    }

    return () => {
      controller.abort()
    }
  })
</script>

<NoteCard class="card2 bg-alt z-feature" event={issue}>
  <div class="flex w-full items-center justify-between gap-2">
    <p class="text-xl">{subject}</p>
  </div>
  <Content event={issue} />
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-grow flex-wrap items-center justify-end gap-2">
      <div class="btn btn-neutral btn-xs relative hidden rounded-full sm:flex">
        <Link external class="w-full cursor-pointer" href={issueLink}>
          <span>Modified {formatTimestampRelative(lastActive)}</span>
        </Link>
      </div>
      <div class="badge badge-lg {statusColor}" title={finalReason || undefined}>
        {displayedStatus}
      </div>
      {#if labelsNormalized.length}
        <div class="flex flex-wrap gap-1">
          {#each labelsNormalized as lbl (lbl)}
            <span class="badge badge-ghost badge-sm">{lbl}</span>
          {/each}
        </div>
      {/if}
      <Button class="btn btn-info btn-sm">
        <Link external class="w-full cursor-pointer" href={issueLink}>
          <span class="">View</span>
        </Link>
      </Button>
      {#if showThreadAction}
        <Button class="btn btn-primary btn-sm" onclick={startThread}>
          <span class="">+Thread</span>
        </Button>
      {/if}
    </div>
  </div>
</NoteCard>
