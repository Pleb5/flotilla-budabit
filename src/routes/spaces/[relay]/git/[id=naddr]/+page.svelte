<script lang="ts">
  import markdownit from "markdown-it"
  import {Card} from "@nostr-git/ui"
  import {
    CircleAlert,
    GitBranch,
    GitPullRequest,
    Users,
    Globe,
    GitCommit,
    User,
    Link,
    Eye,
    BookOpen,
  } from "@lucide/svelte"
  import {fade, fly, slide} from "@lib/transition"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {pushToast} from "@src/app/toast"
  import {formatDistanceToNow} from "date-fns"
  import {nthEq} from "@welshman/lib"
  import Button from "@src/lib/components/Button.svelte"
  import {profilesByPubkey} from "@welshman/app"
  import type { LayoutProps } from "./$types.js"

  let {data}:LayoutProps = $props()
  const {repoClass, repoRelays} = data

  let loading = $state(true)
  let lastCommit = $state<any>(null)

  const stats = $derived([
    {
      label: "Branches",
      value: repoClass.branches?.length || 0,
      icon: GitBranch,
      color: "text-blue-600",
    },
    {
      label: "Doers",
      value: repoClass.maintainers?.length || 0,
      icon: Users,
      color: "text-green-600",
    },
    {
      label: "Issues",
      value: repoClass.issues?.length || 0,
      icon: CircleAlert,
      color: "text-red-600",
    },
    {
      label: "Patches",
      value: repoClass.patches?.length || 0,
      icon: GitPullRequest,
      color: "text-purple-600",
    },
  ])

  const maintainers = repoClass.maintainers.map(
    m => $profilesByPubkey.get(m) ?? {display_name: truncateHash(m), name: truncateHash(m)},
  )

  const repoMetadata = $derived({
    name: repoClass.repo?.name || "Unknown Repository",
    description: repoClass.repo?.description || "",
    repoId: repoClass.repo?.repoId || "",
    maintainers: maintainers || [],
    relays: $repoRelays,
    cloneUrls: repoClass.repo?.clone || [],
    webUrls: repoClass.repo?.web || [],
    mainBranch: repoClass.mainBranch || "main",
    createdAt: repoClass.repoEvent?.created_at
      ? new Date(repoClass.repoEvent.created_at * 1000)
      : null,
    updatedAt: repoClass.repoStateEvent?.created_at
      ? new Date(repoClass.repoStateEvent.created_at * 1000)
      : null,
  })

  let readme = $state<string | undefined>(undefined)
  let renderedReadme = $state<string | undefined>(undefined)
  const md = markdownit({
    html: true,
    linkify: true,
    typographer: true,
  })

  $effect(() => {
    if (repoClass.repoEvent) {
      loadRepoInfo()
    }
  })

  async function loadRepoInfo() {
    try {
      try {
        const readmeContent = await repoClass.getFileContent({path: "README.md"})
        readme = readmeContent
        renderedReadme = readme ? md.render(readme) : ""
      } catch (e) {
        console.log("No README.md found")
      }

      try {
        if (repoClass.mainBranch) {
          const commits = await repoClass.getCommitHistory({
            branch: repoClass.mainBranch,
            depth: 1,
          })
          if (commits && commits.length > 0) {
            lastCommit = commits[0]
          }
        }
      } catch (e) {
        console.log("Could not fetch commit info:", e)
      }

      loading = false
    } catch (e) {
      console.error("Error loading repo info:", e)
      pushToast({message: "Failed to load repository information: " + e, theme: "error"})
      loading = false
    }
  }

  function formatDate(date: Date | null) {
    if (!date) return "Unknown"
    return formatDistanceToNow(date, {addSuffix: true})
  }

  function truncateHash(hash: string, length = 8) {
    return hash ? hash.substring(0, length) : ""
  }
</script>

<div class="relative flex flex-col gap-6 py-2">
  {#if loading}
    <div class="flex justify-center py-8">
      <Spinner />
    </div>
  {:else}
    <!-- Stats Grid -->
    <div class="grid grid-cols-2 gap-4 md:grid-cols-4" transition:fade>
      {#each stats as stat}
        <Card class="p-4 transition-shadow hover:shadow-md">
          <div class="flex items-center gap-3">
            <div class="p-2">
              <stat.icon class="h-5 w-5 {stat.color}" />
            </div>
            <div>
              <p class="text-sm text-muted-foreground">{stat.label}</p>
              <p class="text-2xl font-semibold">{stat.value}</p>
            </div>
          </div>
        </Card>
      {/each}
    </div>

    <div class="grid gap-6 md:grid-cols-2" transition:fly>
      <!-- Repository Details -->
      <Card class="p-6">
        <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
          <GitCommit class="h-5 w-5" />
          Repo Information
        </h3>
        <div class="grid gap-6 md:grid-cols-1">
          <!-- Git Information -->
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-sm text-muted-foreground">Default Branch</span>
              <span class="rounded px-2 py-1 font-mono text-sm">
                {repoMetadata.mainBranch}
              </span>
            </div>

            {#if lastCommit}
              <div class="border-t pt-3">
                <div class="mb-2 flex items-start justify-between">
                  <span class="text-sm text-muted-foreground">Latest Commit</span>
                  <span class="rounded px-2 py-1 font-mono text-xs">
                    {truncateHash(lastCommit.oid)}
                  </span>
                </div>
                <p class="text-sm">{lastCommit.commit.message}</p>
                <div class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <User class="h-3 w-3" />
                  <span>{lastCommit.commit.author.name}</span>
                  <span>•</span>
                  <span>{formatDate(new Date(lastCommit.commit.author.timestamp * 1000))}</span>
                </div>
              </div>
            {/if}

            {#if repoClass.branches && repoClass.branches.length > 0}
              <div class="border-t pt-3">
                <span class="mb-2 block text-sm text-muted-foreground">Branches</span>
                <div class="flex flex-wrap gap-1">
                  {#each repoClass.branches.slice(0, 5) as branch}
                    <span
                      class="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
                      {branch.name}
                      {#if branch.isHead}
                        <span class="ml-1">•</span>
                      {/if}
                    </span>
                  {/each}
                  {#if repoClass.branches.length > 5}
                    <span class="px-2 py-1 text-xs text-muted-foreground">
                      +{repoClass.branches.length - 5} more
                    </span>
                  {/if}
                </div>
              </div>
            {/if}
          </div>

          <!-- Nostr Information -->
          <div class="space-y-3">
            {#if repoMetadata.maintainers.length > 0}
              <div>
                <span class="mb-2 block text-sm text-muted-foreground">Maintainers</span>
                <div class="space-y-1">
                  {#each repoMetadata.maintainers as maintainer}
                    <div class="flex items-center gap-2 text-sm">
                      <User class="h-3 w-3" />
                      <span class="font-mono text-xs"
                        >{maintainer?.display_name ?? maintainer?.name}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            {#if repoMetadata.relays.length > 0}
              <div class="border-t pt-3">
                <span class="mb-2 block text-sm text-muted-foreground">Relays</span>
                <div class="space-y-1">
                  {#each repoMetadata.relays.slice(0, 3) as relay}
                    <div class="flex items-center gap-2 text-sm">
                      <Globe class="h-3 w-3" />
                      <span class="truncate">{relay}</span>
                    </div>
                  {/each}
                  {#if repoMetadata.relays.length > 3}
                    <span class="text-xs text-muted-foreground">
                      +{repoMetadata.relays.length - 3} more relays
                    </span>
                  {/if}
                </div>
              </div>
            {/if}

            {#if repoMetadata.cloneUrls.length > 0}
              <div class="border-t pt-3">
                <span class="mb-2 block text-sm text-muted-foreground">Clone URLs</span>
                <div class="space-y-1">
                  {#each repoMetadata.cloneUrls as url}
                    <div class="flex items-center gap-2 text-sm">
                      <Link class="h-3 w-3" />
                      <span class="truncate font-mono text-xs">{url}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            {#if repoMetadata.webUrls.length > 0}
              <div class="border-t pt-3">
                <span class="mb-2 block text-sm text-muted-foreground">Web URLs</span>
                <div class="space-y-1">
                  {#each repoMetadata.webUrls as url}
                    <div class="flex items-center gap-2 text-sm">
                      <Link class="h-3 w-3" />
                      <a href={url} target="_blank" class="truncate font-mono text-xs">{url}</a>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="border-t pt-3">
              <Button class="btn btn-primary btn-sm" onclick={() => repoClass.resetRepo()}
                >Reset Repo</Button>
            </div>
          </div>
        </div>
      </Card>

      <!-- Activity Overview -->
      {#if repoClass.issues.length > 0 || repoClass.patches.length > 0}
        <Card class="p-6">
          <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Eye class="h-5 w-5" />
            Recent Activity
          </h3>
          <div class="space-y-4">
            {#if repoClass.issues.length > 0}
              <div>
                <h4 class="mb-2 text-sm font-medium text-muted-foreground">Recent Issues</h4>
                <div class="space-y-2">
                  {#each repoClass.issues.slice(0, 3) as issue}
                    <div
                      class="flex items-start gap-3 rounded-lg p-3 outline outline-1 outline-gray-200">
                      <CircleAlert class="mt-0.5 h-4 w-4 text-red-500" />
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium">
                          {issue.tags.find(nthEq(0, "t"))?.[1] || "Untitled Issue"}
                        </p>
                        <p class="text-xs text-muted-foreground">
                          {formatDate(new Date(issue.created_at * 1000))}
                        </p>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            {#if repoClass.patches.length > 0}
              <div>
                <h4 class="mb-2 text-sm font-medium text-muted-foreground">Recent Patches</h4>
                <div class="space-y-2">
                  {#each repoClass.patches.slice(0, 3) as patch}
                    <div
                      class="flex items-start gap-3 rounded-lg p-3 outline outline-1 outline-gray-200">
                      <GitPullRequest class="mt-0.5 h-4 w-4 text-purple-500" />
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium">
                          {patch.tags.find(nthEq(0, "title"))?.[1] || "Untitled Patch"}
                        </p>
                        <p class="text-xs text-muted-foreground">
                          {formatDate(new Date(patch.created_at * 1000))}
                        </p>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </Card>
      {/if}
    </div>
    <!-- README -->
    {#if renderedReadme}
      <div transition:slide>
        <Card class="p-6">
          <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
            <BookOpen class="h-5 w-5" />
            README
          </h3>
          <div class="prose max-w-2xl bg-white dark:bg-zinc-900" in:fly>
            {@html renderedReadme}
            <style>
              .prose {
                color: theme("colors.zinc.50");
                background: none;
              }
              .dark .prose {
                color: theme("colors.white");
              }
              .prose h1,
              .prose h2,
              .prose h3 {
                font-weight: 600;
                line-height: 1.25;
                color: theme("colors.zinc.50");
                margin-top: 2rem;
                margin-bottom: 1rem;
              }
              .prose h1 {
                font-size: 2rem;
                border-bottom: 1px solid theme("colors.zinc.50");
                padding-bottom: 0.3em;
              }
              .prose h2 {
                font-size: 1.5rem;
                border-bottom: 1px solid theme("colors.zinc.50");
                padding-bottom: 0.2em;
              }
              .prose h3 {
                font-size: 1.25rem;
                padding-bottom: 0.1em;
              }
              .prose ul,
              .prose ol {
                margin: 1em 0;
                padding-left: 2em;
              }
              .prose li {
                margin: 0.3em 0;
              }
              .prose a {
                color: theme("colors.accent");
                text-decoration: underline;
                text-underline-offset: 2px;
                transition: color 0.2s;
              }
              .prose a:hover {
                color: theme("colors.primary");
              }
              .prose code {
                background: theme("colors.zinc.700");
                color: theme("colors.zinc.100");
                border-radius: 4px;
                padding: 0.2em 0.4em;
                font-size: 0.95em;
              }
              .prose pre {
                background: theme("colors.zinc.900");
                color: theme("colors.zinc.100");
                border-radius: 8px;
                padding: 1em;
                margin: 1.5em 0;
                font-size: 1em;
                overflow-x: auto;
              }
              .prose blockquote {
                border-left: 4px solid theme("colors.zinc.300");
                background: theme("colors.zinc.50");
                color: theme("colors.zinc.600");
                padding: 1em 1.5em;
                border-radius: 0.5em;
                margin: 1.5em 0;
                font-style: italic;
              }
              .prose table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 1.5em;
                background: theme("colors.zinc.50");
                border-radius: 0.5em;
                overflow: hidden;
              }
              .prose th,
              .prose td {
                border: 1px solid theme("colors.zinc.200");
                padding: 0.6em 1em;
              }
              .prose th {
                background: theme("colors.zinc.100");
                font-weight: 600;
              }
            </style>
          </div>
        </Card>
      </div>
    {/if}
  {/if}
</div>
