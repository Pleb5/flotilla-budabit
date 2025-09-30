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
  import {
    CircleCheck,
    CircleDot,
    FileCode,
    MessageSquare,
    SearchX,
  } from "@lucide/svelte"
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
  import {REPO_RELAYS_KEY} from "@src/app/git-state"
  import {postComment, postStatus} from "@src/app/git-commands"
  import {
    Card,
    IssueThread,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger
  } from "@nostr-git/ui"
  import { normalizeRelayUrl } from "@welshman/util"
  import {
    resolveIssueStatus,
    effectiveLabelsFor
  } from "@nostr-git/core"
  import {
    repoAnnouncements,
    deriveMaintainersForEuc,
    loadRepoAnnouncements
  } from "@src/app/git-state.js"
  import { onMount } from "svelte"

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

  // Repo EUC lookup via announcements (30617) and derived maintainers
  const repoPubkey = (repoClass as any).repoEvent?.pubkey as string | undefined
  const repoD = ((repoClass as any).repoEvent?.tags as any[])?.find?.((t: any[]) => t[0] === 'd')?.[1]
  let repoEuc: string | undefined = $derived.by(() => {
    const match = $repoAnnouncements?.find?.((evt: any) => evt.pubkey === repoPubkey && (evt.tags as string[][]).some((t: string[]) => t[0] === 'd' && t[1] === repoD))
    const eucTag = (match as any)?.tags?.find?.((t: any) => t[0] === 'r' && t[2] === 'euc')
    return eucTag?.[1]
  })
  let groupMaintainers: Set<string> = $state(new Set<string>())
  $effect(() => {
    groupMaintainers = new Set()
    if (repoEuc) {
      const store = deriveMaintainersForEuc(repoEuc)
      const unsub = store.subscribe((s) => {
        groupMaintainers = s || new Set()
      })
      return () => unsub()
    }
  })

  const threadComments = $derived.by(() => {
    if (repoClass.issues && issue) {
      const filters: Filter[] = [{kinds: [COMMENT], "#E": [issue.id]}]
      const relays = (repoClass.relays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
      load({relays: relays as string[], filters})
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

  // NIP-32: label events (1985) targeting this issue
  const getLabelFilter = (): Filter => ({ kinds: [1985], "#e": [issue?.id ?? ""] })
  const labelEvents = $derived.by(() => {
    if (repoClass.issues && issue) {
      const relays = (repoClass.relays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
      load({ relays: relays as string[], filters: [getLabelFilter()] })
      return deriveEvents(repository, { filters: [getLabelFilter()] })
    }
  })
  const labelsNormalized = $derived(() => {
    if (!issue) return [] as string[]
    const merged = effectiveLabelsFor({ self: issueEvent as any, external: ($labelEvents as any) || [] })
    return merged.normalized
  })

  // Resolve effective status using precedence rules (maintainers > author > others; kind; recency)
  const resolved = $derived.by(() => {
    if (!$statusEvents || !issue) return undefined
    const fallbackMaintainers = new Set<string>([...repoClass.maintainers, (repoClass as any).repoEvent?.pubkey].filter(Boolean) as string[])
    const maintainerSet = (groupMaintainers && groupMaintainers.size > 0) ? groupMaintainers : fallbackMaintainers
    return resolveIssueStatus(
      { root: (issueEvent as any), comments: [], statuses: ($statusEvents as any) },
      issue.author.pubkey,
      maintainerSet
    ) as { final: any | undefined; reason: string }
  })

  const statusReason = $derived(() => resolved?.reason)

  let status = $derived.by(() => {
    if ($statusEvents) {
      const final = resolved?.final
      return final ? parseStatusEvent(final as StatusEvent) : undefined
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
      const evt: any = (repoClass as any).repoEvent
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
        recipients: [$pubkey!, evt?.pubkey].filter(Boolean) as string[],
        repoAddr: evt ? Address.fromEvent(evt as any).toString() : "",
        relays: (repoClass.relays || repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean),
      })
      postStatus(statusEvent, (repoClass.relays || repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean))
    }
  })

  const repoRelays = getContext<string[]>(REPO_RELAYS_KEY)
  const onCommentCreated = async (comment: CommentEvent) => {
    const relays = (repoClass.relays || repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    await postComment(comment, relays).result
  }

  onMount(() => {
    loadRepoAnnouncements()
  })

  const isMaintainerOrAuthor = $derived.by(() => {
    return (
      $pubkey === issue?.author.pubkey ||
      ((repoClass as any).repoEvent?.pubkey as string | undefined) === $pubkey ||
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
              <div class="git-tag bg-secondary" title={statusReason() || undefined}>
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
              {#if labelsNormalized()?.length}
                <div class="flex flex-wrap gap-1">
                  {#each labelsNormalized() as lbl (lbl)}
                    <span class="git-tag bg-muted text-xs">{lbl}</span>
                  {/each}
                </div>
              {/if}
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
