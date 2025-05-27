<script lang="ts">
  import {getContext} from "svelte"
  import {derived as _derived, type Readable} from "svelte/store"
  import {getRepoFileContentFromEvent, listBranchesFromEvent} from "@nostr-git/core"
  import markdownit from "markdown-it"
  import {sortBy} from "@welshman/lib"
  import {
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    type TrustedEvent,
  } from "@welshman/util"
  import {repository} from "@welshman/app"
  import {deriveEvents} from "@welshman/store"
  import {getRootEventTagValue} from "@src/lib/util"
  import {Card} from "@nostr-git/ui"
  import {CircleAlert, GitBranch, GitPullRequest, Users} from "@lucide/svelte"
  import {
    parseRepoAnnouncementEvent,
    parseRepoStateEvent,
    type RepoAnnouncementEvent,
    type RepoStateEvent,
  } from "@nostr-git/shared-types"

  const eventStore = getContext<Readable<TrustedEvent>>("repo-event")
  const repo = getContext<{
    repo: Readable<TrustedEvent>
    state: () => Readable<RepoStateEvent>
    issues: () => Readable<TrustedEvent[]>
    patches: () => Readable<TrustedEvent[]>
  }>("repo")

  let loading = $state(false)

  const repoState = repo.state()
  const issues = repo.issues()
  const patches = repo.patches()

  let issueCount = $derived.by(() => $issues?.length ?? 0)

  let branchCount = $derived.by(() => {
    if ($repoState) {
      const repo = parseRepoStateEvent($repoState as RepoStateEvent)
      return repo.refs.length
    }
    return 0
  })

  let contributorCount = $derived.by(() => {
    if ($eventStore) {
      const repo = parseRepoAnnouncementEvent($eventStore as RepoAnnouncementEvent)
      return repo.maintainers?.length ?? 0
    }
    return 0
  })

  const statuses = $derived.by(() => {
    if ($issues) {
      const statusFilter = [
        {
          kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
          "#e": $issues.map((issue: TrustedEvent) => issue.id),
        },
      ]
      return deriveEvents(repository, {filters: statusFilter})
    }
  })

  const orderedElements = $derived.by(() => {
    if ($issues && $statuses) {
      const latestStatuses = []
      for (const issue of $issues) {
        // Need deep copy, no mutations allowed
        let latestStatus: {sid: string; ts: number} | undefined
        const filteredStatuses = $statuses.filter(s => getRootEventTagValue(s.tags) === issue.id)
        if (filteredStatuses.length > 0) {
          latestStatus = {sid: "", ts: 0}
          for (const status of filteredStatuses) {
            if (status.created_at > latestStatus.ts) {
              latestStatus = {sid: status.id, ts: status.created_at}
            }
          }
        }
        latestStatuses.push({
          issue: {id: issue.id, ts: issue.created_at},
          latestStatus: latestStatus,
        })
      }

      return sortBy(e => {
        const createdAt = e.latestStatus?.ts ?? e.issue.ts
        return -createdAt
      }, latestStatuses)
    }
  })

  const mainBranch = $derived.by(async () => {
    if ($repoState) {
      const repo = parseRepoStateEvent($repoState as RepoStateEvent)
      console.log(repo)
      return repo.head
    } else {
      const branches = await listBranchesFromEvent({repoEvent: $eventStore})
      console.log(branches)
      return branches?.[0].name
    }
  })

  const stats = [
    {
      label: "Branches",
      value: () => branchCount,
      icon: GitBranch,
    },
    {label: "Contributors", value: () => contributorCount, icon: Users},
    {label: "Issues", value: () => issueCount, icon: CircleAlert},
    {
      label: "Patches",
      value: () => $patches.length,
      icon: GitPullRequest,
    },
  ]

  let readme = $state<string | undefined>(undefined)
  let renderedReadme = $state<string | undefined>(undefined)
  const md = markdownit({
    html: true,
    linkify: true,
    typographer: true,
  })

  $effect(async () => {
    if (!mainBranch) return
    readme = await getRepoFileContentFromEvent({
      repoEvent: $eventStore,
      branch: (await mainBranch)?.split("/").pop() || "master",
      path: "README.md",
    })
    renderedReadme = readme ? md.render(readme) : ""
  })
</script>

<div class="relative flex flex-col gap-3 px-2">
  <div class="grid grid-cols-4 gap-4">
    {#each stats as stat}
      <Card class="p-4">
        <div class="flex items-center gap-2">
          <stat.icon class="h-5 w-5 text-muted-foreground" />
          <div>
            <p class="text-sm text-muted-foreground">{stat.label}</p>
            <p class="text-2xl font-semibold">{stat.value()}</p>
          </div>
        </div>
      </Card>
    {/each}
  </div>
  {#if renderedReadme}
    <div
      class="prose-slate dark:prose-invert prose-headings:font-bold prose-headings:mb-3 prose-headings:mt-8 prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-p:leading-relaxed prose-p:my-4 prose-ul:my-4 prose-ol:my-4 prose-li:marker:text-primary prose-blockquote:border-l-4 prose-blockquote:border-accent prose-blockquote:bg-accent/10 prose-blockquote:p-4 prose-blockquote:rounded prose-blockquote:my-6 prose-table:my-6 prose-table:border prose-table:border-muted prose-th:bg-muted/50 prose-th:font-semibold prose-th:p-3 prose-td:p-3 prose-pre:bg-zinc-900 prose-pre:rounded-lg prose-pre:p-4 prose-code:bg-zinc-800 prose-code:rounded-md prose-code:px-2 prose-code:py-1 prose-code:text-sm prose max-w-none overflow-x-auto rounded-xl border border-muted bg-muted p-8 shadow-md">
      {@html renderedReadme}
    </div>
  {:else}
    <div class="text-muted-foreground">No README.md found.</div>
  {/if}

  <style>
    /* Further polish for markdown rendering in README */
    .prose h1,
    .prose h2,
    .prose h3 {
      letter-spacing: -0.01em;
    }
    .prose h1 {
      border-bottom: 1px solid theme("colors.border");
      padding-bottom: 0.3em;
    }
    .prose blockquote {
      border-left-width: 4px;
      border-color: var(--tw-prose-accent);
      background: var(--tw-prose-accent-bg, rgba(59, 130, 246, 0.05));
      padding: 1rem;
      border-radius: 0.5rem;
      margin: 1.5rem 0;
    }
    .prose pre {
      margin: 1.5rem 0;
    }
    .prose table {
      border-radius: 0.5rem;
      overflow: hidden;
    }
    .prose th,
    .prose td {
      border: 1px solid theme("colors.zinc.700");
    }
  </style>
</div>
