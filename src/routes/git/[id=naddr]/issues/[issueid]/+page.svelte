<script lang="ts">
  import {
    GIT_ISSUE,
    parseIssueEvent,
    extractLabelEvents,
    type CommentEvent,
    type LabelEvent,
    type StatusEvent,
  } from "@nostr-git/core/events"
  import {resolveIssueStatus} from "@nostr-git/core/events"
  import {Card, IssueThread, Status} from "@nostr-git/ui"
  import {page} from "$app/stores"
  import {CircleCheck, CircleDot, FileCode, MessageSquare, SearchX} from "@lucide/svelte"
  import {
    COMMENT,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    type EventContent,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {load} from "@welshman/net"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {profilesByPubkey, profileSearch} from "@welshman/app"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import NostrGitProfileComponent from "@app/components/NostrGitProfileComponent.svelte"
  import {slide} from "svelte/transition"
  import {getContext} from "svelte"
  import {postComment} from "@app/core/git-commands"
  import {PeoplePicker} from "@nostr-git/ui"
  import {createLabelEvent} from "@nostr-git/core/events"
  import {publishDelete, publishReaction} from "@app/core/commands"
  import EventActions from "@app/components/EventActions.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import {ROLE_NS, buildRoleLabelEvent} from "@app/util/labels"
  import {
    deriveRoleAssignments,
    getRepoMaintainers,
    getRepoScopedRelays,
    loadRepoContext,
    repoAnnouncementsByAddress,
  } from "@app/core/git-state"
  import {toNaturalArray} from "@app/util/labels"
  import {resolveIssueEdits} from "@app/util/issue-edits"
  import {normalizeRelays} from "@app/core/community"
  import {loadBudabitProfile} from "@app/core/profile-resolver"
  import Markdown from "@src/lib/components/Markdown.svelte"
  import {HIDDEN_ROOT_IDS_KEY, REPO_KEY} from "@app/core/git-state"
  import type {Repo} from "@nostr-git/ui"
  import type {Readable} from "svelte/store"

  const repoClass = getContext<Repo>(REPO_KEY)
  const hiddenRootIdsStore = getContext<Readable<Set<string>>>(HIDDEN_ROOT_IDS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const naddrRelays = $derived.by(() => (($page.data as any)?.naddrRelays || []) as string[])
  const repoBoundRelays = $derived.by(() => {
    return getRepoScopedRelays(repoClass.repoEvent as any, naddrRelays)
  })
  const repoCommunityProfileRelays = $derived.by(() =>
    normalizeRelays([repoClass.community?.relay || ""]),
  )

  const issueId = $page.params.issueid
  const hiddenRootIds = $derived.by(() =>
    hiddenRootIdsStore ? $hiddenRootIdsStore : new Set<string>(),
  )
  const isHiddenRoot = $derived.by(() => hiddenRootIds.has(issueId))
  const GIT_COVER_LETTER_KIND = 1624
  const isDeletedRepositoryEvent = (event?: {id?: string}) =>
    Boolean(event && (repository as any).isDeleted?.(event))
  const getIssueRepoAddress = (event?: {tags?: string[][]}) =>
    (event?.tags || []).find((tag: string[]) => tag[0] === "a")?.[1] || ""

  const directIssueEventStore = $derived.by(() => {
    if (!issueId) return undefined
    return deriveEventsAsc(
      deriveEventsById({
        repository,
        filters: [{ids: [issueId]}],
      }),
    )
  })
  const directIssueEvent = $derived.by(() => {
    const event = directIssueEventStore ? $directIssueEventStore?.[0] : undefined
    if (!event || isDeletedRepositoryEvent(event as any)) return undefined
    return event.kind === GIT_ISSUE ? (event as any) : undefined
  })
  const issueEvent = $derived.by(
    () => repoClass.issues.find(i => i.id === issueId) || (directIssueEvent as any),
  )
  const hasRepoAnnouncement = $derived.by(() => Boolean(repoClass.repoEvent))

  let isResolvingIssue = $state(false)
  let didResolveIssue = $state(false)
  const ISSUE_RESOLVE_TIMEOUT_MS = 7000

  $effect(() => {
    if (!issueId) {
      isResolvingIssue = false
      didResolveIssue = true
      return
    }

    if (issueEvent) {
      isResolvingIssue = false
      didResolveIssue = true
      return
    }

    const relays = repoBoundRelays
    if (relays.length === 0) {
      isResolvingIssue = !hasRepoAnnouncement
      didResolveIssue = hasRepoAnnouncement
      return
    }

    isResolvingIssue = true
    didResolveIssue = false

    let cancelled = false
    const timeout = setTimeout(() => {
      if (cancelled) return
      isResolvingIssue = false
      didResolveIssue = true
    }, ISSUE_RESOLVE_TIMEOUT_MS)

    void loadRepoContext({rootId: issueId, relays}).finally(() => {
      if (cancelled) return
      clearTimeout(timeout)
      isResolvingIssue = false
      didResolveIssue = true
    })

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  })

  // Filter helpers used when refreshing labels/description updates after publishing
  const getLabelFilter = (): Filter => ({kinds: [1985], "#e": [issueEvent?.id ?? ""]})
  const getCoverLetterFilter = (): Filter => ({
    kinds: [GIT_COVER_LETTER_KIND],
    "#e": [issueEvent?.id ?? ""],
  })

  const allIssueLabelEvents = $derived.by(() =>
    deriveEventsAsc(deriveEventsById({repository, filters: [getLabelFilter()]})),
  )
  const coverLetterEvents = $derived.by(() =>
    deriveEventsAsc(deriveEventsById({repository, filters: [getCoverLetterFilter()]})),
  )

  const roleLabelEvents = $derived.by(() => {
    const events = ($allIssueLabelEvents || []) as LabelEvent[]
    return events.filter(
      (ev: any) =>
        ev?.kind === 1985 &&
        Array.isArray(ev.tags) &&
        ev.tags.some((t: string[]) => t[0] === "L" && t[1] === ROLE_NS),
    )
  })
  const parsedIssueLabelEvents = $derived.by(() =>
    extractLabelEvents((($allIssueLabelEvents || []) as LabelEvent[]) || []),
  )
  const issueLabelEventsById = $derived.by(() => {
    const map = new Map<string, LabelEvent>()
    for (const event of (($allIssueLabelEvents || []) as LabelEvent[]) || []) {
      if (event?.id) map.set(event.id, event)
    }
    return map
  })
  const assigneeLabelEvents = $derived.by(() => {
    const events = (roleLabelEvents || []) as LabelEvent[]
    return events.filter(
      ev =>
        Array.isArray(ev.tags) &&
        ev.tags.some((t: string[]) => t[0] === "l" && t[1] === "assignee" && t[2] === ROLE_NS),
    )
  })

  const fallbackMaintainers = $derived.by(() => {
    const owner = (repoClass as any).repoEvent?.pubkey as string | undefined
    return new Set<string>([...(repoClass.maintainers || []), owner].filter(Boolean) as string[])
  })

  const currentRepoAddress = $derived.by(() => ((repoClass as any)?.address as string) || "")
  const issueRepoAddress = $derived.by(() => getIssueRepoAddress(issueEvent as any))
  const issueEditRepoAddress = $derived.by(() => issueRepoAddress || currentRepoAddress)
  const issueRepoAddresses = $derived.by(() => (issueEditRepoAddress ? [issueEditRepoAddress] : []))
  const issueCommentRepoRefs = $derived.by(() =>
    issueRepoAddresses.length > 0
      ? issueRepoAddresses
      : issueEditRepoAddress
        ? [issueEditRepoAddress]
        : [],
  )
  const issueCommentRelayHint = $derived.by(() => repoBoundRelays[0] || undefined)

  const issueRepoEvent = $derived.by(() => {
    return (
      (issueRepoAddress && $repoAnnouncementsByAddress.get(issueRepoAddress)) ||
      (currentRepoAddress && $repoAnnouncementsByAddress.get(currentRepoAddress)) ||
      ((repoClass as any)?.repoEvent as any)
    )
  })
  const currentRepoOwner = $derived.by(
    () => ((issueRepoEvent as any)?.pubkey || (repoClass as any)?.owner || "") as string,
  )
  const issueMaintainers = $derived.by(() => {
    const maintainers = getRepoMaintainers(issueRepoEvent as any)
    if (maintainers.length > 0) return new Set(maintainers)
    return fallbackMaintainers
  })
  const issueStatusRepo = $derived.by(
    () =>
      ({
        maintainers: Array.from(issueMaintainers),
        relays: repoClass.relays || repoBoundRelays || [],
        repoEvent: issueRepoEvent || (repoClass as any).repoEvent,
        owner: currentRepoOwner,
        getCommitHistory: (...args: any[]) => (repoClass as any).getCommitHistory(...args),
      }) as unknown as Repo,
  )

  const issue = $derived.by(() => {
    if (!issueEvent) return undefined
    const parsed = parseIssueEvent(issueEvent)
    const edits = resolveIssueEdits({
      issueEvent: issueEvent as any,
      labelEvents: (($allIssueLabelEvents || []) as LabelEvent[]) || [],
      coverLetters: (($coverLetterEvents || []) as any[]) || [],
      maintainers: issueMaintainers,
    })
    return {
      ...parsed,
      subject: edits.subject || parsed.subject,
      content: edits.content,
      labels: edits.labels,
    }
  })

  const authoritativeEditors = $derived.by(() => {
    if (!issue) return new Set<string>()
    return new Set<string>([issue.author.pubkey, ...Array.from(issueMaintainers)])
  })

  // Mirrored issues (from import) have "imported" and "original_date" tags — show original date
  const isMirrored = $derived.by(
    () =>
      (issueEvent?.tags as Array<[string, string]> | undefined)?.some(t => t[0] === "imported") ??
      false,
  )
  const originalDateTag = $derived.by(
    () =>
      (issueEvent?.tags as Array<[string, string]> | undefined)?.find(
        t => t[0] === "original_date",
      )?.[1],
  )
  const displayDate = $derived.by(() => {
    if (isMirrored && originalDateTag) {
      const sec = parseInt(originalDateTag, 10)
      if (!Number.isNaN(sec)) return new Date(sec * 1000).toISOString()
    }
    return issue?.createdAt ?? ""
  })
  const displayDateFormatted = $derived.by(() =>
    displayDate ? new Date(displayDate).toLocaleString() : "",
  )

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
      const relays = getPublishRelays()
      const labelEvent = createLabelEvent({
        content: "",
        e: [issue.id],
        a: issueEditRepoAddress ? [issueEditRepoAddress] : [],
        namespaces: ["#t"],
        labels: [{namespace: "#t", value}],
      }) as any
      publishThunk({event: labelEvent, relays})
      await load({relays: relays as string[], filters: [getLabelFilter()]})
      newLabel = ""
    } catch (e) {
      console.error("[IssueDetail] Failed to add label", e)
    } finally {
      addingLabel = false
    }
  }

  let editingTitle = $state(false)
  let savingTitle = $state(false)
  let titleDraft = $state("")

  let editingDescription = $state(false)
  let savingDescription = $state(false)
  let descriptionDraft = $state("")

  const rootIssueTags = $derived.by(() =>
    ((issueEvent?.tags as string[][]) || [])
      .filter((tag: string[]) => tag[0] === "t")
      .map((tag: string[]) => tag[1])
      .filter(Boolean),
  )

  $effect(() => {
    if (!issue || editingTitle) return
    titleDraft = issue.subject || ""
  })

  $effect(() => {
    if (!issue || editingDescription) return
    descriptionDraft = issue.content || ""
  })

  const getPublishRelays = () => [...repoBoundRelays]

  const deleteReaction = async (event: TrustedEvent) => {
    const relays = getPublishRelays()
    if (relays.length === 0) return

    publishDelete({
      event,
      relays,
    })
  }

  const createReaction = async (template: EventContent) => {
    if (!issueEvent) return

    const relays = getPublishRelays()
    if (relays.length === 0) return

    publishReaction({
      ...template,
      event: issueEvent as TrustedEvent,
      relays,
    })
  }

  const publishTagDeleteMarker = (labelValue: string, relays: string[], includeUgc = false) => {
    if (!issue) return
    const namespaces = includeUgc ? ["#t", "ugc"] : ["#t"]
    const labels = namespaces.map(namespace => ({namespace, value: labelValue, op: "del" as const}))
    const labelEvent = createLabelEvent({
      content: "",
      e: [issue.id],
      a: issueEditRepoAddress ? [issueEditRepoAddress] : [],
      namespaces,
      labels,
    }) as any
    publishThunk({event: labelEvent, relays})
  }

  const removeLabel = async (labelValue: string) => {
    if (!issue || !isMaintainerOrAuthor) return

    const value = labelValue.trim()
    if (!value) return

    const relays = getPublishRelays()
    if (relays.length === 0) return

    const rootSet = new Set(rootIssueTags || [])

    try {
      if (rootSet.has(value)) {
        publishTagDeleteMarker(value, relays)
      } else {
        const relevant = ((parsedIssueLabelEvents || []) as any[])
          .filter(label => {
            if (label.value !== value) return false
            if (label.op === "del") return false
            if (label.namespace === ROLE_NS || label.namespace === "#subject") return false
            const event = issueLabelEventsById.get(label.id || "")
            return Boolean(event && authoritativeEditors.has(event.pubkey))
          })
          .sort((a, b) => {
            const byTime = (b.created_at || 0) - (a.created_at || 0)
            if (byTime !== 0) return byTime
            return (b.id || "").localeCompare(a.id || "")
          })

        const own = relevant.find(label => {
          const event = issueLabelEventsById.get(label.id || "")
          return event?.pubkey === $pubkey
        })
        const candidate = own || relevant[0]
        const eventToDelete = candidate?.id ? issueLabelEventsById.get(candidate.id) : undefined

        if (eventToDelete && eventToDelete.pubkey === $pubkey) {
          publishDelete({event: eventToDelete as any, relays})
        } else {
          publishTagDeleteMarker(value, relays, true)
        }
      }

      await load({relays, filters: [getLabelFilter()]})
    } catch (error) {
      console.error("[IssueDetail] Failed to remove label", error)
    }
  }

  const saveTitleEdit = async () => {
    const value = titleDraft.trim()
    if (!issue || !value || !isMaintainerOrAuthor) return
    if (value === (issue.subject || "")) {
      editingTitle = false
      return
    }

    const relays = getPublishRelays()
    if (relays.length === 0) return

    try {
      savingTitle = true
      const labelEvent = createLabelEvent({
        content: "",
        e: [issue.id],
        a: issueEditRepoAddress ? [issueEditRepoAddress] : [],
        namespaces: ["#subject"],
        labels: [{namespace: "#subject", value}],
      }) as any
      publishThunk({event: labelEvent, relays})
      await load({relays, filters: [getLabelFilter()]})
      editingTitle = false
    } catch (error) {
      console.error("[IssueDetail] Failed to edit title", error)
    } finally {
      savingTitle = false
    }
  }

  const saveDescriptionEdit = async () => {
    const value = descriptionDraft.trim()
    if (!issue || !isMaintainerOrAuthor) return
    if (value === (issue.content || "")) {
      editingDescription = false
      return
    }

    const relays = getPublishRelays()
    if (relays.length === 0) return

    try {
      savingDescription = true
      const coverLetterEvent = {
        kind: GIT_COVER_LETTER_KIND,
        content: value,
        tags: [
          ["e", issue.id],
          ...(issueEditRepoAddress ? ([["a", issueEditRepoAddress]] as string[][]) : []),
        ],
        created_at: Math.floor(Date.now() / 1000),
      }
      publishThunk({event: coverLetterEvent as any, relays})
      await load({relays, filters: [getCoverLetterFilter()]})
      editingDescription = false
    } catch (error) {
      console.error("[IssueDetail] Failed to edit description", error)
    } finally {
      savingDescription = false
    }
  }

  $effect(() => {
    if (!issueEvent) return
    const relays = getPublishRelays()
    if (relays.length === 0) return
    load({relays, filters: [getLabelFilter(), getCoverLetterFilter()]})
  })

  const threadComments = $derived.by(() => {
    if (issue) {
      const filters: Filter[] = [
        {kinds: [COMMENT], "#E": [issue.id]},
        {kinds: [COMMENT], "#e": [issue.id]},
      ]
      const relays = getPublishRelays()
      load({relays: relays as string[], filters})
      return deriveEventsAsc(deriveEventsById({repository, filters}))
    }
  })
  const visibleThreadComments = $derived.by(() =>
    (threadComments ? (($threadComments || []) as CommentEvent[]) : []).filter(
      comment => !hiddenRootIds.has(comment.id),
    ),
  )

  const getStatusFilter = () => ({
    kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
    "#e": [issue?.id ?? ""],
  })

  const statusEvents = $derived.by(() => {
    return deriveEventsAsc(deriveEventsById({repository, filters: [getStatusFilter()]}))
  })

  // Centralized NIP-32 labels via store; avoid calling .get() in Svelte 5
  const labelsNormalized = $derived.by(() => {
    if (!issue) return [] as string[]
    return toNaturalArray(issue.labels || [])
  })

  const roleAssignments = $derived.by(() => (issue ? deriveRoleAssignments(issue.id) : undefined))
  const assignees = $derived.by(() =>
    Array.from((roleAssignments?.get()?.assignees || new Set()) as Set<string>),
  )
  const recommendedAssigneePubkeys = $derived.by(() => {
    const selectedAssignees = new Set(assignees)
    return Array.from(authoritativeEditors).filter(
      (pubkey): pubkey is string => Boolean(pubkey) && !selectedAssignees.has(pubkey),
    )
  })

  // PeoplePicker will render from LabelEvent[] directly

  // Resolve effective status using precedence rules (maintainers > author > others; kind; recency)
  const resolved = $derived.by(() => {
    if (!$statusEvents || !issue) return undefined
    return resolveIssueStatus(
      {root: issueEvent as any, comments: [], statuses: $statusEvents as any},
      issue.author.pubkey,
      issueMaintainers,
      {repoOwner: currentRepoOwner, importedRoot: isMirrored},
    ) as {final: any | undefined; reason: string}
  })

  // Title icon should match Status component logic: authorized events (author or maintainers/owner), latest by time
  const titleCurrentStatusEvent = $derived.by(() => {
    return resolved?.final as StatusEvent | undefined
  })
  const statusIcon = $derived(() => getStatusIcon(titleCurrentStatusEvent?.kind))

  function getStatusIcon(kind: number | undefined) {
    switch (kind) {
      case GIT_STATUS_OPEN:
        return {icon: CircleDot, color: "text-emerald-400", bg: "bg-emerald-500/10"}
      case GIT_STATUS_COMPLETE:
        return {icon: CircleCheck, color: "text-sky-400", bg: "bg-sky-500/10"}
      case GIT_STATUS_CLOSED:
        return {icon: CircleCheck, color: "text-rose-400", bg: "bg-rose-500/10"}
      case GIT_STATUS_DRAFT:
        return {icon: FileCode, color: "text-amber-300", bg: "bg-amber-500/10"}
      default:
        return {icon: CircleDot, color: "text-muted-foreground", bg: "bg-muted"}
    }
  }

  // Remove inline status state and auto-publish; Status component handles publishing

  const onCommentCreated = async (comment: CommentEvent) => {
    postComment(comment, getPublishRelays())
  }

  const isMaintainerOrAuthor = $derived.by(() => {
    if (!issue || !$pubkey) return false
    if ($pubkey === issue.author.pubkey) return true
    return issueMaintainers.has($pubkey)
  })

  const handleStatusPublish = async (statusEvent: StatusEvent) => {
    const maintainers = Array.from(issueMaintainers)
    const recipients = Array.from(
      new Set([...(maintainers || []), issue?.author.pubkey, $pubkey].filter(Boolean)),
    )
    const tags = (statusEvent.tags || []).filter(
      (tag: string[]) => tag[0] !== "p" && tag[0] !== "a",
    )
    if (issueEditRepoAddress) tags.unshift(["a", issueEditRepoAddress] as ["a", string])
    tags.push(...recipients.map(recipient => ["p", recipient] as ["p", string]))
    const statusWithRecipients = {
      ...statusEvent,
      tags,
    }
    return publishThunk({event: statusWithRecipients as any, relays: getPublishRelays()})
  }

  const toPersonSuggestion = (pubkey: string) => {
    const profile = $profilesByPubkey.get(pubkey)
    return {
      pubkey,
      name: profile?.name,
      picture: profile?.picture,
      nip05: profile?.nip05,
      display_name: profile?.display_name,
    }
  }

  $effect(() => {
    for (const pubkey of recommendedAssigneePubkeys) {
      if ($profilesByPubkey.get(pubkey)) continue
      loadBudabitProfile(pubkey, {relays: repoCommunityProfileRelays}).catch(() => undefined)
    }
  })

  // Profile functions for PeoplePicker
  const getProfile = async (pubkey: string) => {
    const profile = $profilesByPubkey.get(pubkey)
    if (profile) {
      return {
        name: profile.name,
        picture: profile.picture,
        nip05: profile.nip05,
        display_name: profile.display_name,
      }
    }
    await loadBudabitProfile(pubkey, {relays: repoCommunityProfileRelays})

    return $profilesByPubkey.get(pubkey) ? toPersonSuggestion(pubkey) : null
  }

  const searchProfiles = async (query: string) => {
    const trimmedQuery = query.trim()
    const selectedAssignees = new Set(assignees)
    const pubkeys = trimmedQuery
      ? $profileSearch.searchValues(trimmedQuery)
      : recommendedAssigneePubkeys

    return Array.from(new Set(pubkeys))
      .filter((pubkey): pubkey is string => Boolean(pubkey) && !selectedAssignees.has(pubkey))
      .map(toPersonSuggestion)
  }
</script>

<svelte:head>
  <title>{repoClass.name} - {issue?.subject}</title>
</svelte:head>

{#if isHiddenRoot}
  <div class="flex flex-col items-center justify-center px-4 py-8 sm:py-12">
    <SearchX class="mb-2 h-6 w-6 sm:h-8 sm:w-8" />
    <p class="text-center text-sm sm:text-base">This issue was hidden as spam.</p>
  </div>
{:else if issue}
  <div class="px-2 py-2 sm:px-0 sm:py-4" transition:slide>
    <Card class="git-card p-4 transition-colors sm:p-6">
      <div class="flex items-start gap-2 sm:gap-4">
        {#if statusIcon}
          {@const {icon: Icon, color, bg} = statusIcon()}
          <div class="mt-1 flex-shrink-0">
            <div
              class={`flex h-8 w-8 items-center justify-center rounded-full ${bg} sm:h-10 sm:w-10`}>
              <Icon class={`h-4 w-4 sm:h-6 sm:w-6 ${color}`} />
            </div>
          </div>
        {/if}
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              {#if editingTitle && isMaintainerOrAuthor}
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    class="min-h-[44px] min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm sm:min-h-0"
                    bind:value={titleDraft}
                    placeholder="Issue title"
                    onkeydown={e => {
                      if (e.key === "Enter") saveTitleEdit()
                      if (e.key === "Escape") {
                        editingTitle = false
                        titleDraft = issue.subject || ""
                      }
                    }} />
                  <div class="flex items-center gap-2">
                    <button
                      class="rounded-md border border-border px-3 py-1 text-sm"
                      onclick={saveTitleEdit}
                      disabled={savingTitle || !titleDraft.trim()}>
                      {savingTitle ? "Saving..." : "Save"}
                    </button>
                    <button
                      class="rounded-md border border-border px-3 py-1 text-sm"
                      onclick={() => {
                        editingTitle = false
                        titleDraft = issue.subject || ""
                      }}
                      disabled={savingTitle}>
                      Cancel
                    </button>
                  </div>
                </div>
              {:else}
                <h1 class="break-words text-lg font-semibold sm:text-xl">
                  {issue.subject || "Issue"}
                </h1>
                {#if isMaintainerOrAuthor}
                  <button
                    class="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onclick={() => {
                      editingTitle = true
                      titleDraft = issue.subject || ""
                    }}>
                    Edit title
                  </button>
                {/if}
              {/if}
            </div>
            <div class="flex items-center gap-2">
              <ReactionSummary
                event={issueEvent as any}
                url={repoBoundRelays[0] || ""}
                relays={repoBoundRelays}
                {deleteReaction}
                {createReaction}
                reactionClass="tooltip-left" />
              <EventActions
                event={issueEvent as any}
                url={repoBoundRelays[0] || ""}
                relays={repoBoundRelays}
                ownerPubkey={currentRepoOwner}
                noun="issue" />
            </div>
          </div>
          <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Status
              repo={issueStatusRepo}
              rootId={issue.id}
              rootKind={GIT_ISSUE}
              rootAuthor={issue.author.pubkey}
              statusEvents={($statusEvents || []) as StatusEvent[]}
              actorPubkey={$pubkey}
              compact={true}
              {isMirrored}
              ProfileComponent={NostrGitProfileComponent} />
            <span
              class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground sm:text-sm">
              <ProfileLink pubkey={issue?.author.pubkey} relays={repoCommunityProfileRelays} />
              <span class="hidden sm:inline">opened this issue •</span>
              <span class="sm:hidden">opened</span>
              <span class="break-all text-xs sm:break-normal">{displayDateFormatted}</span>
            </span>
          </div>
        </div>
      </div>

      <div
        class="prose-sm dark:prose-invert prose mt-6 max-w-none break-words sm:mt-8 [&_*]:break-words [&_code]:break-words [&_pre]:overflow-x-auto">
        {#if editingDescription && isMaintainerOrAuthor}
          <div class="not-prose space-y-3">
            <textarea
              class="min-h-[220px] w-full rounded-md border border-border bg-background p-3 text-sm"
              bind:value={descriptionDraft}
              placeholder="Issue description"></textarea>
            <div class="flex items-center gap-2">
              <button
                class="rounded-md border border-border px-3 py-1 text-sm"
                onclick={saveDescriptionEdit}
                disabled={savingDescription}>
                {savingDescription ? "Saving..." : "Save description"}
              </button>
              <button
                class="rounded-md border border-border px-3 py-1 text-sm"
                onclick={() => {
                  editingDescription = false
                  descriptionDraft = issue.content || ""
                }}
                disabled={savingDescription}>
                Cancel
              </button>
            </div>
          </div>
        {:else}
          <Markdown content={issue.content} event={issueEvent as any} relays={repoBoundRelays} />
          {#if isMaintainerOrAuthor}
            <button
              class="not-prose mt-3 text-xs text-muted-foreground underline-offset-2 hover:underline"
              onclick={() => {
                editingDescription = true
                descriptionDraft = issue.content || ""
              }}>
              Edit description
            </button>
          {/if}
        {/if}
      </div>

      <div class="git-separator my-4 sm:my-6"></div>

      <!-- Labels Section -->
      <div class="my-4 space-y-2">
        {#if labelsNormalized?.length}
          <div class="flex flex-wrap gap-1">
            {#each labelsNormalized as lbl (lbl)}
              <span class="git-tag inline-flex items-center gap-1 bg-muted text-xs">
                <span>{lbl}</span>
                {#if isMaintainerOrAuthor}
                  <button
                    class="rounded-sm px-1 text-[11px] leading-none text-muted-foreground hover:text-foreground"
                    onclick={() => removeLabel(lbl)}
                    aria-label={`Remove ${lbl}`}>
                    ×
                  </button>
                {/if}
              </span>
            {/each}
          </div>
        {/if}
        {#if isMaintainerOrAuthor}
          <div
            class="flex w-full max-w-full flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <input
              class="min-h-[44px] min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm sm:min-h-0 sm:px-2 sm:py-1"
              placeholder="Add tag..."
              bind:value={newLabel}
              onkeydown={e => {
                if (e.key === "Enter") addLabel()
              }} />
            <button
              class="min-h-[44px] flex-shrink-0 rounded-md border border-border px-3 py-2 text-sm sm:min-h-0 sm:px-3 sm:py-1"
              onclick={addLabel}
              disabled={addingLabel || !newLabel.trim()}>
              <span class="whitespace-nowrap">{addingLabel ? "Adding..." : "Add Tag"}</span>
            </button>
          </div>
        {/if}
      </div>

      <!-- Assignees Section -->
      <div class="my-4 space-y-2">
        <h3 class="text-base font-medium">Assignees</h3>
        {#if isMaintainerOrAuthor}
          <PeoplePicker
            selected={assigneeLabelEvents}
            placeholder="Search for assignees..."
            maxSelections={10}
            showAvatars={true}
            showSuggestionsOnFocus={true}
            compact={false}
            {getProfile}
            {searchProfiles}
            add={async (pubkey: string) => {
              if (!issue) return
              try {
                const publishRelays = getPublishRelays()
                const roleLabelEvent = buildRoleLabelEvent({
                  rootId: issue.id,
                  role: "assignee",
                  pubkeys: [pubkey],
                  repoAddr: issueEditRepoAddress,
                })
                publishThunk({event: roleLabelEvent as any, relays: publishRelays})
                await load({
                  relays: publishRelays,
                  filters: [{kinds: [1985], "#e": [issue.id]}],
                })
              } catch (err) {
                console.error("[IssueDetail] Failed to add assignee", err)
              }
            }}
            onDeleteLabel={async (evt: LabelEvent) => {
              if (!issue) return
              try {
                const relays = getPublishRelays()
                publishDelete({event: evt as any, relays})
                await load({relays, filters: [{kinds: [1985], "#e": [issue.id]}]})
              } catch (err) {
                console.error("[IssueDetail] Failed to delete assignee label", err)
              }
            }} />
        {:else if assignees.length}
          <div class="flex flex-wrap gap-2">
            {#each assignees as pk (pk)}
              <ProfileLink pubkey={pk} relays={repoCommunityProfileRelays} />
            {/each}
          </div>
        {:else}
          <div class="text-xs text-muted-foreground sm:text-sm">No assignees yet.</div>
        {/if}
      </div>

      <!-- Status Section -->
      <div class="my-4 sm:my-6">
        <Status
          repo={issueStatusRepo}
          rootId={issue.id}
          rootKind={GIT_ISSUE}
          rootAuthor={issue.author.pubkey}
          statusEvents={($statusEvents || []) as StatusEvent[]}
          actorPubkey={$pubkey}
          compact={false}
          {isMirrored}
          ProfileComponent={NostrGitProfileComponent}
          onPublish={handleStatusPublish} />
      </div>

      <div class="git-separator my-4 sm:my-6"></div>

      <h2 class="my-2 flex items-center gap-2 text-base font-medium sm:text-lg">
        <MessageSquare class="h-4 w-4 flex-shrink-0 sm:h-5 sm:w-5" />
        <span class="break-words">Discussion ({visibleThreadComments.length})</span>
      </h2>

      <IssueThread
        issueId={issue?.id ?? ""}
        issueKind={GIT_ISSUE.toString() as "1621"}
        comments={visibleThreadComments}
        currentCommenter={$pubkey || ""}
        onCommentCreated={$pubkey ? onCommentCreated : undefined}
        relays={repoBoundRelays}
        repoAddress={issueEditRepoAddress}
        rootEvent={issueEvent as any}
        repoRefs={issueCommentRepoRefs}
        relayHint={issueCommentRelayHint}
        ownerPubkey={currentRepoOwner} />
    </Card>
  </div>
{:else if isResolvingIssue || !didResolveIssue}
  <div class="flex flex-col items-center justify-center px-4 py-8 sm:py-12">
    <p class="text-center text-sm text-muted-foreground sm:text-base">Loading issue...</p>
  </div>
{:else}
  <div class="flex flex-col items-center justify-center px-4 py-8 sm:py-12">
    <SearchX class="mb-2 h-6 w-6 sm:h-8 sm:w-8" />
    <p class="text-center text-sm sm:text-base">No issue found.</p>
  </div>
{/if}
