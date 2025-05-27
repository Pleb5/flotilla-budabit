<script lang="ts">
  import {load} from "@welshman/net"
  import {
    Address,
    GIT_ISSUE,
    type TrustedEvent,
  } from "@welshman/util"
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

  const onReactionClick = (content: string, events: TrustedEvent[]) => {
    const reaction = events.find(e => e.pubkey === $pubkey)
    if (reaction) {
      publishDelete({relays: [url], event: reaction})
    } else {
      publishReaction({event, content, relays: [url]})
    }
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

  // This might be broken depending on repo owners updating their links or
  // even including one in the first place
  // const web = event.tags.find(nthEq(0, "web"))?.[1]
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
  <div class="flex flex-grow flex-wrap justify-end gap-2">
    <Button class="btn btn-primary btn-sm">
      <Link
        class="w-full cursor-pointer"
        href={makeGitPath(url, Address.fromEvent(event).toNaddr())}>
        <span class="">Browse</span>
      </Link>
    </Button>
    {#if showIssues}
      <Button class="btn btn-secondary btn-sm">
        <Link
          class="flex h-full w-full cursor-pointer items-center"
          href={makeGitPath(url, Address.fromEvent(event).toNaddr()) + "/issues"}>
          <Spinner loading={loadingIssues} minHeight={"min-h-6"}>
            {"Issues (" + issueCount + ")"}
          </Spinner>
        </Link>
      </Button>
    {/if}

    {#if showActivity}
      <ReactionSummary {url} {event} {onReactionClick} reactionClass="tooltip-left" />
      <ThunkStatusOrDeleted {event} />
      <EventActions {url} {event} noun="Repo" />
    {/if}
  </div>
</div>
