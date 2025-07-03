<script lang="ts">
  import {load} from "@welshman/net"
  import {Address, GIT_ISSUE, type EventContent, type TrustedEvent} from "@welshman/util"
  import {pubkey, repository} from "@welshman/app"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishDelete, publishReaction} from "@app/commands"
  import {makeGitPath} from "@app/routes"
  import Button from "@src/lib/components/Button.svelte"
  import Link from "@src/lib/components/Link.svelte"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {deriveEvents} from "@welshman/store"
  import {nthEq} from "@welshman/lib"
    import { navigating } from "$app/state"
    import { goto } from "$app/navigation"

  interface Props {
    url: any
    event: TrustedEvent
    showIssues?: boolean
    showActivity?: boolean
  }

  const {url, event, showIssues = true, showActivity}: Props = $props()

  let loadingIssues = $state(true)

  const [tagId, ...relays] = event.tags.find(nthEq(0, "relays")) || []

  const issueFilter = {
    kinds: [GIT_ISSUE],
    "#a": [Address.fromEvent(event).toString()],
  }

  const issues = deriveEvents(repository, {filters: [issueFilter]})
  const issueCount = $derived($issues.length)

  const onPublishDelete = (event: TrustedEvent) => publishDelete({relays: [url], event})

  const onPublishReaction = (event: EventContent) => {
    publishReaction({event: event as TrustedEvent, content: event.content, relays: [url]})
  }

  $effect(() => {
    if (event) {
      if (showIssues) {
        load({relays: relays, filters: [issueFilter]}).then(() => {
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
    const destination = makeGitPath(url, Address.fromEvent(event).toNaddr())
    goto(destination)
  }

  const gotoIssues = async () => {
    const destination = makeGitPath(
      url, Address.fromEvent(event).toNaddr()
    ) + "/issues"
    
    goto(destination)
  }

  // This might be broken depending on repo owners updating their links or
  // even including one in the first place
  // const web = event.tags.find(nthEq(0, "web"))?.[1]
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
  <div class="flex flex-grow flex-wrap justify-end gap-2">
    <Button
      class="cursor-pointer btn btn-primary btn-sm"
      onclick={gotoRepo}
      disabled={!!navigating.type}>
      <Spinner loading={!!navigating.type} minHeight={"min-h-6"}>
        Browse
      </Spinner>
    </Button>
    {#if showIssues}
      <Button
        class="flex btn btn-secondary btn-sm cursor-pointer items-center"
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
