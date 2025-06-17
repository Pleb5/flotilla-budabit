<script lang="ts">
  import {getContext} from "svelte"
  import markdownit from "markdown-it"
  import {Card, Repo} from "@nostr-git/ui"
  import {CircleAlert, GitBranch, GitPullRequest, Users} from "@lucide/svelte"
  import {fly} from "@lib/transition"
  import Spinner from "@src/lib/components/Spinner.svelte"
    import { pushToast } from "@src/app/toast"

  let loading = $state(true)

  const repoClass = getContext<Repo>("repoClass")

  const stats = [
    {
      label: "Branches",
      value: () => repoClass.branches?.length,
      icon: GitBranch,
    },
    {
      label: "Contributors",
      value: () => repoClass.maintainers?.length,
      icon: Users,
    },
    {
      label: "Issues",
      value: () => repoClass.issues?.length,
      icon: CircleAlert},
    {
      label: "Patches",
      value: () => repoClass.patches?.length,
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

  $effect(() => {
    if (repoClass.repoEvent) {
      repoClass
        .getFileContent({
          path: "README.md",
        })
        .then(content => {
          readme = content
          renderedReadme = readme ? md.render(readme) : ""
          loading = false
        })
        .catch((e) => {
          console.error(e)
          pushToast({message: "Failed to load README.md: " + e, theme: "error"})
          loading = false
        })
    }
  })
</script>

<div class="relative flex flex-col gap-3 px-2">
  <div class="grid grid-cols-4 gap-4">
    {#each stats as stat}
      <Card class="p-4">
        <div class="flex items-center gap-2">
          <stat.icon class="h-5 text-muted-foreground" />
          <div>
            <p class="text-sm text-muted-foreground">{stat.label}</p>
            <p class="text-2xl font-semibold">{stat.value()}</p>
          </div>
        </div>
      </Card>
    {/each}
  </div>
  {#if renderedReadme}
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
  {:else if loading}
    <Spinner {loading}>Loading README.md...</Spinner>
  {:else}
    <div class="text-muted-foreground">No README.md found.</div>
  {/if}
</div>
