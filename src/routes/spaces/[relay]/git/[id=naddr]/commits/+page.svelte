<script lang="ts">
  import {GitBranch, Funnel, User, Search} from "@lucide/svelte"
  import {
    Button,
    Input,
    Select,
    SelectContent,
    SelectTrigger,
    SelectItem,
    Separator,
    CommitCard,
  } from "@nostr-git/ui"
  import {formatDistanceToNow} from "date-fns"
  import Spinner from "@src/lib/components/Spinner.svelte"

  let {data} = $props()
  const {repoClass} = data

  // Reactive state for UI
  let searchQuery = $state("")
  let selectedBranch = $state([repoClass.mainBranch.split("/").pop() || ""])
  let selectedAuthor = $state([])

  // Get commits from the repo class (lazy-loaded and reactive)
  let commitsLoading = $state(true)
  let commitsError = $state<string | undefined>(undefined)
  let commits = $state<any[]>([])
  // Get available branches for filtering
  let branches = $state<string[]>([])

  // Get unique authors from commits for filtering
  let authors = $state<Set<string>>(new Set())

  $effect(() => {
    if (repoClass.commits) {
      commits = repoClass.commits
    }
  })

  $effect(() => {
    if (repoClass.branches) {
      branches = repoClass.branches.map((branch: any) => branch.name.split("/").pop())
    }
  })

  $effect(() => {
    if (repoClass.commits && repoClass.commits.length > 0) {
      authors = new Set(repoClass.commits.map((commit: any) => commit.commit.author.name))
      commitsLoading = false
    }
  })

  // Filter commits based on search and filters
  const filteredCommits = $derived.by(() => {
    if (commits) {
      let filtered = commits

      // Filter by search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        filtered = filtered.filter(
          commit =>
            commit.commit.message.toLowerCase().includes(query) ||
            commit.commit.author.name.toLowerCase().includes(query) ||
            commit.oid.toLowerCase().includes(query),
        )
      }

      // Filter by branch (if branch filtering is implemented)
      if (selectedBranch.length > 0) {
        //filtered = filtered.filter(commit => commit.branch === selectedBranch[0])
      }

      // Filter by author
      if (selectedAuthor.length > 0) {
        filtered = filtered.filter(commit => commit.commit.author.name === selectedAuthor[0])
      }

      return filtered
    }
    return []
  })

  const handleReact = (commitId: string, type: "heart") => {
    console.log(`Reacting to commit ${commitId} with ${type}`)
  }

  const handleComment = (commitId: string, comment: string) => {
    console.log(`Commenting on commit ${commitId}: ${comment}`)
    // TODO: Implement Nostr comments for commits
  }
</script>

<div class="flex flex-col gap-6">
  {#if commitsLoading}
    <div class="flex items-center justify-center py-12">
      <Spinner loading={commitsLoading}>
        Loading commits...
      </Spinner>
    </div>
  {:else if commitsError}
    <div class="py-12 text-center">
      <p class="text-muted-foreground">Failed to load commits.</p>
    </div>
  {:else}
    <div class="mt-6">
      <div class="mb-6 flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row">
        <div class="flex-1">
          <div class="relative">
            <Search
              class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
            <Input placeholder="Search commits..." bind:value={searchQuery} class="pl-10" />
          </div>
        </div>

        <Select bind:value={selectedBranch}>
          <SelectTrigger class="w-[140px]">
            <GitBranch class="mr-2 h-4 w-4" />
            <span>{selectedBranch}</span>
          </SelectTrigger>
          <SelectContent>
            {#each branches as branch (branch)}
              <SelectItem value={branch}>
                {branch}
              </SelectItem>
            {/each}
          </SelectContent>
        </Select>

        <Select bind:value={selectedAuthor}>
          <SelectTrigger class="w-[120px]">
            <User class="mr-2 h-4 w-4" />
            <span>{selectedAuthor.length > 0 ? selectedAuthor[0] : "All authors"}</span>
          </SelectTrigger>
          <SelectContent>
            {#each authors as author (author)}
              <SelectItem value={author}>
                {author}
              </SelectItem>
            {/each}
          </SelectContent>
        </Select>
      </div>

      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">
            {filteredCommits?.length} commit{filteredCommits?.length !== 1 ? "s" : ""}
            {#if selectedBranch.length > 0}
              on {selectedBranch[0]}{/if}
          </h2>

          <Button variant="outline" size="sm" class="gap-2">
            <Funnel class="h-4 w-4" />
            More filters
          </Button>
        </div>

        <Separator />

        {#if !repoClass.commits || repoClass.commits.length === 0}
          <div class="py-12 text-center">
            <p class="text-muted-foreground">No commits found in this repository.</p>
          </div>
        {:else}
          <div class="space-y-3">
            {#each filteredCommits as commit (commit.oid)}
              <CommitCard {commit} onReact={handleReact} onComment={handleComment} />
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
