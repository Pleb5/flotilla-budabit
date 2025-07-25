<script lang="ts">
  import {
    createStatusEvent,
    GIT_ISSUE,
    parseIssueEvent,
    parseStatusEvent,
    type CommentEvent,
    type StatusEvent,
  } from "@nostr-git/shared-types"
  import {page} from "$app/stores"
  import {CircleCheck, CircleDot, FileCode, MessageSquare, SearchX} from "@lucide/svelte"
  import markdownit from "markdown-it"
  import {
    Address,
    COMMENT,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    type Filter,
  } from "@welshman/util"
  import {deriveEvents} from "@welshman/store"
  import {load} from "@welshman/net"
  import {pubkey, repository} from "@welshman/app"
  import ProfileLink from "@src/app/components/ProfileLink.svelte"
  import {slide} from "svelte/transition"
  import {getContext} from "svelte"
  import {REPO_RELAYS_KEY} from "@src/app/state.js"
  import {postComment, postStatus} from "@src/app/commands.js"
  import {Card, IssueThread, Select, SelectContent, SelectItem, SelectTrigger} from "@nostr-git/ui"

  const {data} = $props()
  const {repoClass} = data

  const markdown = markdownit({
    html: true,
    linkify: true,
    typographer: true,
  })

  const issueId = $page.params.issueid
  const issueEvent = repoClass.issues.find(i => i.id === issueId)
  const issue = issueEvent ? parseIssueEvent(issueEvent) : undefined

  const threadComments = $derived.by(() => {
    if (repoClass.issues && issue) {
      const filters: Filter[] = [{kinds: [COMMENT], "#E": [issue.id]}]
      load({relays: repoClass.relays, filters})
      return deriveEvents(repository, {filters})
    }
  })

  const getStatusFilter = () => ({
    kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
    "#e": [issue?.id ?? ""],
  })

  const statusEvents = $derived.by(() => {
    return deriveEvents(repository, {filters: [getStatusFilter()]})
  })

  let status = $derived.by(() => {
    if ($statusEvents) {
      const statusEvent = $statusEvents.sort((a, b) => b.created_at - a.created_at)[0]
      return statusEvent ? parseStatusEvent(statusEvent as StatusEvent) : undefined
    }
  })

  const statusIcon = $derived(() => getStatusIcon(status?.raw.kind))

  function getStatusIcon(kind: number | undefined) {
    switch (kind) {
      case GIT_STATUS_OPEN:
        return {icon: CircleDot, color: "text-amber-500"}
      case GIT_STATUS_COMPLETE:
        return {icon: CircleCheck, color: "text-green-500"}
      case GIT_STATUS_CLOSED:
        return {icon: CircleCheck, color: "text-red-500"}
      case GIT_STATUS_DRAFT:
        return {icon: FileCode, color: "text-gray-500"}
      default:
        return {icon: CircleDot, color: "text-red-100"}
    }
  }

  let statuses = $state(["open", "resolved", "closed", "draft"])
  let currentStatus = $derived.by(() => {
    if (status) {
      if (status.status === "applied") {
        return "resolved"
      }
      return status.status
    }
    return "unknown"
  })

  $effect(() => {
    if (currentStatus && currentStatus !== status?.status) {
      const statusEvent = createStatusEvent({
        kind:
          currentStatus === "open"
            ? GIT_STATUS_OPEN
            : currentStatus === "resolved"
              ? GIT_STATUS_COMPLETE
              : currentStatus === "closed"
                ? GIT_STATUS_CLOSED
                : GIT_STATUS_DRAFT,
        content: "",
        rootId: issueId,
        recipients: [$pubkey!, repoClass.repoEvent?.pubkey],
        repoAddr: Address.fromEvent(repoClass.repoEvent!).toString() || "",
        relays: repoClass.relays || repoRelays || [],
      })
      postStatus(statusEvent, repoClass.relays || repoRelays || [])
    }
  })

  const repoRelays = getContext<string[]>(REPO_RELAYS_KEY)
  const onCommentCreated = async (comment: CommentEvent) => {
    await postComment(comment, repoClass.relays || repoRelays).result
  }

  const isMaintainerOrAuthor = $derived.by(() => {
    return (
      $pubkey === issue?.author.pubkey ||
      repoClass.repoEvent?.pubkey === $pubkey ||
      repoClass.maintainers.includes($pubkey!)
    )
  })
</script>

{#if issue}
  <div class="z-10 sticky top-0 items-center justify-between py-4 backdrop-blur" transition:slide>
    <Card class="git-card transition-colors">
      <div class="flex items-start gap-4">
        {#if statusIcon}
          {@const {icon: Icon, color} = statusIcon()}
          <div class="mt-1">
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
              <Icon class={`h-6 w-6 ${color}`} />
            </div>
          </div>
        {/if}
        <div>
          <h1 class="break-words text-2xl font-semibold">{issue.subject || "Issue"}</h1>
          <div class="mt-2 flex items-center gap-2">
            {#if isMaintainerOrAuthor}
              <Select bind:value={currentStatus} type="single">
                <SelectTrigger class="w-[140px]">
                  <span>{currentStatus}</span>
                </SelectTrigger>
                <SelectContent>
                  {#each statuses as status (status)}
                    <SelectItem value={status}>
                      {status}
                    </SelectItem>
                  {/each}
                </SelectContent>
              </Select>
            {:else}
              <div class="git-tag bg-secondary">
                {#if status}
                  {status?.status === "open"
                    ? "Open"
                    : status?.status === "applied"
                      ? "Resolved"
                      : "Closed"}
                {:else}
                  {currentStatus}
                {/if}
              </div>
            {/if}

            <span class="text-sm text-muted-foreground">
              <ProfileLink pubkey={issue?.author.pubkey}></ProfileLink>
              opened this issue • {new Date(issue?.createdAt).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      <div class="mt-4">
        <p class="text-muted-foreground">{@html markdown.render(issue.content)}</p>
      </div>

      <div class="git-separator my-6"></div>

      <h2 class="my-2 flex items-center gap-2 text-lg font-medium">
        <MessageSquare class="h-5 w-5" />
        Discussion ({$threadComments?.length})
      </h2>

      <IssueThread
        issueId={issue?.id ?? ""}
        issueKind={GIT_ISSUE.toString() as "1621"}
        comments={$threadComments as CommentEvent[]}
        currentCommenter={$pubkey!}
        {onCommentCreated} />
    </Card>
  </div>
{:else}
  <div class="flex flex-col items-center justify-center py-12">
    <SearchX class="mb-2 h-8 w-8" />
    No issue found.
  </div>
{/if}
