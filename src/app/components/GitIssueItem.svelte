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
  import {userMutes} from "@welshman/app"
  import {formatTimestampRelative} from "@welshman/lib"
  import {load, request} from "@welshman/net"
  import {now, nthEq, sortBy} from "@welshman/lib"
  import {GIT_REPO, GitIssueStatus} from "@src/lib/util"
  import NoteCard from "./NoteCard.svelte"
  import Content from "./Content.svelte"
  import {nip19} from "nostr-tools"
  import Link from "@src/lib/components/Link.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import {onMount} from "svelte"
  import {pushModal} from "../modal"
  import ThreadCreate from "./ThreadCreate.svelte"
  import {decodeRelay} from "../state"
  import {Router} from "@welshman/router"

  let {
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

  const mutedPubkeys = getPubkeyTagValues(getListTags($userMutes))

  let statusColor = $state("badge-success")
  let displayedStatus = $state(GitIssueStatus.OPEN)

  $effect(() => {
    if (latestStatus) {
      switch (latestStatus.kind) {
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
    }
  })

  const controller = new AbortController()

  const loadRepoAndStatus = async () => {
    if (aTag && aTag.length > 0) {
      const repoFilter = {
        kinds: [GIT_REPO],
        authors: [pubkey!],
        "#d": [repoDtag],
      }

      const events = await load({
        relays: queryRelays,
        filters: [repoFilter],
      })

      if (events.length > 0) {
        const repoEvent = events[0]

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

        latestStatus = sortBy(s => -s.created_at, statuses)[0]

        statusFilter.since = now()
        request({
          signal: controller.signal,
          relays: queryRelays,
          filters: [statusFilter],
          onEvent: (status: TrustedEvent) => {
            latestStatus = status
          },
        })
      }
    }
  }

  const startThread = () =>
    pushModal(ThreadCreate, {url: url, jobOrGitIssue: issue, relayHint: queryRelays[0]})

  onMount(() => {
    if (fetchRepoAndStatus) loadRepoAndStatus()

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
      <div class="badge badge-lg {statusColor}">
        {displayedStatus}
      </div>
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
