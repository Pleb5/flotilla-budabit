<script lang="ts">
  import {
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
  import {postComment, postStatus, postLabel} from "@src/app/git-commands"
  import {
    Card,
    IssueThread,
    Status
  } from "@nostr-git/ui"
  import { normalizeRelayUrl } from "@welshman/util"
  import {
    resolveIssueStatus,
  } from "@nostr-git/core"
  import { deriveEffectiveLabels } from "@src/app/git-state"
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

  // Filter helper used when refreshing labels after publishing a new one
  const getLabelFilter = (): Filter => ({ kinds: [1985], "#e": [issue?.id ?? ""] })

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

  // NIP-32: Add label UI state and publisher
  let newLabel = $state("")
  let addingLabel = $state(false)
  const addLabel = async () => {
    const value = newLabel.trim()
    if (!value || !issue) return
    if (!$pubkey) return
    // Avoid duplicates
    const existing = new Set(labelsNormalized || [])
    if (existing.has(value)) return
    try {
      addingLabel = true
      const relays = (repoClass.relays || repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
      console.debug("[IssueDetail] addLabel start", { value, issueId: issue.id, pubkey: $pubkey, relays })
      const labelEvent: any = {
        kind: 1985,
        content: "",
        // Reference the issue and include both 'L' (canonical) and 'l' (compat) label tags
        tags: [["e", issue.id], ["L", value], ["l", value]],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: $pubkey,
        id: "",
        sig: "",
      }
      console.debug("[IssueDetail] addLabel event payload", labelEvent)
      postLabel(labelEvent, relays)
      console.debug("[IssueDetail] addLabel published")
      // Refresh labels from relays to reflect the change sooner
      console.debug("[IssueDetail] addLabel refreshing", { filter: getLabelFilter() })
      await load({ relays: relays as string[], filters: [getLabelFilter()] })
      // Give indexers a moment, then log current normalized labels
      setTimeout(() => {
        console.debug("[IssueDetail] post-refresh labels", { labels: labelsNormalized })
      }, 1000)
      newLabel = ""
    } catch (e) {
      console.error("[IssueDetail] Failed to add label", e)
    } finally {
      addingLabel = false
    }
  }

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

  // Normalize helper same as issues list page
  const toNaturalLabel = (s: string): string => {
    const idx = s.lastIndexOf("/")
    return idx >= 0 ? s.slice(idx + 1) : s.replace(/^#/, "")
  }
  // Centralized NIP-32 labels via store; avoid calling .get() in Svelte 5
  const effStore = $derived.by(() => (issue ? deriveEffectiveLabels(issue.id) : undefined))
  const labelsNormalized = $derived.by(() => {
    if (!issue) return [] as string[]
    const eff = $effStore as any
    const flat = eff && eff.flat ? Array.from(eff.flat) : []
    return flat.map((v: unknown) => toNaturalLabel(String(v)))
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
  // Title icon should match Status component logic: authorized events (author or maintainers/owner), latest by time
  const titleCurrentStatusEvent = $derived.by(() => {
    if (!$statusEvents || !issue) return undefined
    const owner = (repoClass as any).repoEvent?.pubkey
    const maintainerSet = new Set<string>([...repoClass.maintainers, owner].filter(Boolean) as string[])
    const authorized = ($statusEvents as StatusEvent[]).filter(
      (e) => e.pubkey === issue.author.pubkey || maintainerSet.has(e.pubkey)
    )
    if (authorized.length === 0) return undefined
    return [...authorized].sort((a, b) => b.created_at - a.created_at)[0]
  })
  const statusIcon = $derived(() => getStatusIcon(titleCurrentStatusEvent?.kind))


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

  // Remove inline status state and auto-publish; Status component handles publishing

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

  const handleStatusPublish = async (statusEvent: StatusEvent) => {
    console.log("[IssueDetail] Publishing status", statusEvent)
    const relays = (repoClass.relays || repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    const thunk = postStatus(statusEvent as any, relays)
    console.log("[IssueDetail] Status publish thunk", thunk)
    return thunk
  }
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
            <Status
              repo={repoClass}
              rootId={issue.id}
              rootKind={1621}
              rootAuthor={issue.author.pubkey}
              statusEvents={($statusEvents || []) as StatusEvent[]}
              actorPubkey={$pubkey}
              compact={true}
              ProfileComponent={ProfileLink} />
            <span class="text-sm text-muted-foreground">
              <ProfileLink pubkey={issue?.author.pubkey}></ProfileLink>
              opened this issue • {new Date(issue?.createdAt).toLocaleString()}
            </span>
          </div>
      </div>
      </div>

      <div class="mt-4 prose prose-sm dark:prose-invert max-w-none">
        {@html markdown.render(issue.content)}
      </div>

      <div class="git-separator my-6"></div>

      <!-- Labels Section -->
      <div class="my-4 space-y-2">
        {#if labelsNormalized?.length}
          <div class="flex flex-wrap gap-1">
            {#each labelsNormalized as lbl (lbl)}
              <span class="git-tag bg-muted text-xs">{lbl}</span>
            {/each}
          </div>
        {/if}
        {#if isMaintainerOrAuthor}
          <div class="flex items-center gap-2">
            <input
              class="rounded-md border border-border bg-background px-2 py-1 text-sm"
              placeholder="Add tag..."
              bind:value={newLabel}
              onkeydown={(e) => { if (e.key === 'Enter') addLabel() }}
            />
            <button
              class="rounded-md border border-border px-3 py-1 text-sm"
              onclick={addLabel}
              disabled={addingLabel || !newLabel.trim()}
            >
              {addingLabel ? 'Adding...' : 'Add Tag'}
            </button>
          </div>
        {/if}
      </div>

      <!-- Status Section -->
      <div class="my-6">
        <Status
          repo={repoClass}
          rootId={issue.id}
          rootKind={1621}
          rootAuthor={issue.author.pubkey}
          statusEvents={($statusEvents || []) as StatusEvent[]}
          actorPubkey={$pubkey}
          compact={false}
          ProfileComponent={ProfileLink}
          onPublish={handleStatusPublish} />
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
