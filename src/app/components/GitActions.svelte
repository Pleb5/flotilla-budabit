<script lang="ts">
  import {load} from "@welshman/net"
  import {Address, GIT_ISSUE, type EventContent, type TrustedEvent} from "@welshman/util"
  import {repository} from "@welshman/app"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishDelete, publishReaction} from "@app/commands"
  import {makeGitPath} from "@app/routes"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {deriveEvents} from "@welshman/store"
  import {nthEq} from "@welshman/lib"
  import {navigating} from "$app/state"
  import {goto} from "$app/navigation"
  import {nip19} from "nostr-tools"
  import type {AddressPointer} from "nostr-tools/nip19"
  import {canonicalRepoKey, sanitizeRelays} from "@nostr-git/core"
  import {pushToast} from "@app/toast"
  import {normalizeRelayUrl} from "@welshman/util"

  interface Props {
    url: any
    event: TrustedEvent
    showIssues?: boolean
    showActivity?: boolean
  }

  const {url, event, showIssues = true, showActivity}: Props = $props()

  let loadingIssues = $state(true)

  const [tagId, ...relays] = sanitizeRelays(event.tags.find(nthEq(0, "relays")) || [])

  const issueFilter = {
    kinds: [GIT_ISSUE],
    "#a": [Address.fromEvent(event).toString()],
  }

  const issues = deriveEvents(repository, {filters: [issueFilter]})
  const issueCount = $derived($issues.length)

  const onPublishDelete = (event: TrustedEvent) =>
    publishDelete({relays: [normalizeRelayUrl(url)], event})

  const onPublishReaction = (event: EventContent) => {
    publishReaction({
      event: event as TrustedEvent,
      content: event.content,
      relays: [normalizeRelayUrl(url)],
    })
  }

  $effect(() => {
    if (event) {
      if (showIssues) {
        const cleanRelays = (relays || []).map(u => normalizeRelayUrl(u)).filter(Boolean)
        load({relays: cleanRelays as string[], filters: [issueFilter]}).then(() => {
          loadingIssues = false
        })
      }
    }
  })

  $effect(() => {
    if (navigating.type) {
    }
  })

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
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
  <div class="flex flex-grow flex-wrap justify-end gap-2">
    <Button
      class="btn btn-primary btn-sm cursor-pointer"
      onclick={gotoRepo}
      disabled={!!navigating.type}>
      <Spinner loading={!!navigating.type} minHeight={"min-h-6"}>Browse</Spinner>
    </Button>
    {#if showIssues}
      <Button
        class="btn btn-secondary btn-sm flex cursor-pointer items-center"
        onclick={gotoIssues}
        disabled={!!navigating.type}>
        <Spinner loading={loadingIssues || !!navigating.type} minHeight={"min-h-6"}>
          {"Issues (" + issueCount + ")"}
        </Spinner>
      </Button>
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
