<script lang="ts">
  import {Button, PatchCard} from "@nostr-git/ui"
  import {CalendarDays, Check, Clock, Funnel, GitCommit, SearchX, User, X} from "@lucide/svelte"
  import {nthEq} from "@welshman/lib"
  import {createSearch, pubkey} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/requests"
  import {
    GIT_STATUS_OPEN,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
  } from "@welshman/util"
  import {fly, slide, slideAndFade} from "@lib/transition"
  import {load} from "@welshman/net"
  import {
    getTags,
    type CommentEvent,
    type PatchEvent,
    type StatusEvent,
  } from "@nostr-git/shared-types"
  import {parseGitPatchFromEvent} from "@nostr-git/core"
  import Icon from "@src/lib/components/Icon.svelte"
  import {isMobile} from "@src/lib/html.js"
  import {postComment} from "@src/app/commands.js"
  import ProfileName from "@src/app/components/ProfileName.svelte"

  const {data} = $props()
  const {repoClass, comments, statusEvents, patchFilter, repoRelays, uniqueAuthors} = data

  // Filter and sort options
  let statusFilter = $state<string>("open") // all, open, applied, closed, draft
  let sortBy = $state<string>("newest") // newest, oldest, status, commits
  let authorFilter = $state<string>("") // empty string means all authors
  let showFilters = $state(false)
  let searchTerm = $state("")

  const patchList = $derived.by(() => {
    if (repoClass.patches && $statusEvents.length > 0 && $comments) {
      // First get all root patches
      let filteredPatches = repoClass.patches
        .filter((patch: PatchEvent) => {
          const tags = getTags(patch, "t")
          return tags.length > 0 && tags[0][1] === "root"
        })
        .map((patch: PatchEvent) => {
          const status = $statusEvents
            ?.filter((s: any) => {
              let [_, eventId] = s.tags.find(nthEq(0, "e")) || []
              return eventId === patch.id
            })
            .sort((a: any, b: any) => b.created_at - a.created_at)[0]

          const patches = repoClass.patches.filter(issue => {
            const tags = getTags(issue, "e")
            return tags.length > 0 && tags[0][1] === patch.id
          })
          const parsedPatch = parseGitPatchFromEvent(patch)

          const commentEvents = $comments?.filter((comment: any) => {
            const tags = getTags(comment, "E")
            return tags.length > 0 && tags[0][1] === patch.id
          })

          return {
            ...patch,
            patches,
            status,
            parsedPatch,
            comments: commentEvents,
            // Add commit count directly for easier sorting
            commitCount: parsedPatch?.commitCount || 0,
          }
        })

      if (statusFilter !== "all") {
        filteredPatches = filteredPatches.filter(patch => {
          if (!patch.status) {
            return statusFilter === "open"
          }

          switch (statusFilter) {
            case "open":
              return patch.status.kind === GIT_STATUS_OPEN
            case "applied":
              return patch.status.kind === GIT_STATUS_COMPLETE
            case "closed":
              return patch.status.kind === GIT_STATUS_CLOSED
            case "draft":
              return patch.status.kind === GIT_STATUS_DRAFT
            default:
              return true
          }
        })
      }

      // Apply author filter
      if (authorFilter) {
        filteredPatches = filteredPatches.filter(patch => patch.pubkey === authorFilter)
      }

      let sortedPatches = [...filteredPatches]

      const currentSortBy = sortBy

      if (currentSortBy === "newest") {
        sortedPatches.sort((a, b) => b.created_at - a.created_at)
      } else if (currentSortBy === "oldest") {
        sortedPatches.sort((a, b) => a.created_at - b.created_at)
      } else if (currentSortBy === "status") {
        // Sort by status priority: open, draft, complete, closed
        sortedPatches.sort((a, b) => {
          const getStatusPriority = (status?: any) => {
            if (!status) return 0 // Open (default)
            switch (status.kind) {
              case GIT_STATUS_OPEN:
                return 0
              case GIT_STATUS_DRAFT:
                return 1
              case GIT_STATUS_COMPLETE:
                return 2
              case GIT_STATUS_CLOSED:
                return 3
              default:
                return 4
            }
          }
          return getStatusPriority(a.status) - getStatusPriority(b.status)
        })
      } else if (currentSortBy === "commits") {
        // Sort by commit count (highest first)
        sortedPatches.sort((a, b) => b.commitCount - a.commitCount)
      }
      return sortedPatches
    }
    return []
  })

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  const onCommentCreated = async (comment: CommentEvent) => {
    await postComment(comment, repoClass.relays || repoRelays).result
  }

  $effect(() => {
    if (repoClass.patches) {
      load({
        relays: repoClass.relays,
        filters: [patchFilter],
      })

      makeFeed({
        element: element!,
        relays: repoClass.relays,
        feedFilters: [patchFilter],
        subscriptionFilters: [patchFilter],
        initialEvents: patchList,
        onExhausted: () => {
          loading = false
        },
      })
      loading = false
    }
  })

  const searchedPatches = $derived.by(() => {
    const patchesToSearch = patchList.map(patch => {
      return {
        id: patch.id,
        title: patch.parsedPatch.title,
      }
    })
    const patchesSearch = createSearch(patchesToSearch, {
      getValue: (patch: {id: string; title: string}) => patch.id,
      fuseOptions: {
        keys: [{name: "title"}],
        includeScore: true,
        threshold: 0.3,
        isCaseSensitive: false,
        // When true, search will ignore location and distance, so it won't
        // matter where in the string the pattern appears
        ignoreLocation: true,
      },
      sortFn: ({score, item}) => {
        if (score && score > 0.3) return -score!
        return item.title
      },
    })
    const searchResults = patchesSearch.searchOptions(searchTerm)
    const result = patchList.filter(p => searchResults.find(res => res.id === p.id))
    return result
  })
</script>

<div bind:this={element}>
  <div class="z-10 sticky -top-8 z-nav mb-2 flex flex-col gap-y-2 py-4 backdrop-blur">
    <div class=" flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold">Patches</h2>
        <p class="text-sm text-muted-foreground max-sm:hidden">Review and merge code changes</p>
      </div>
    </div>
    <div class="row-2 input grow overflow-x-hidden">
      <Icon icon="magnifer" />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus={!isMobile}
        class="w-full"
        bind:value={searchTerm}
        type="text"
        placeholder="Search patches..." />
      <Button
        variant="outline"
        size="sm"
        class="gap-2"
        onclick={() => (showFilters = !showFilters)}>
        <Funnel class="h-4 w-4" />
        {showFilters ? "Hide Filters" : "Filter"}
      </Button>
    </div>
  </div>

  {#if showFilters}
    <div class="mb-6 rounded-md border border-border bg-card p-4" transition:slide>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <!-- Status Filter -->
        <div>
          <h3 class="mb-2 text-sm font-medium">Status</h3>
          <div class="flex flex-wrap gap-2">
            <Button
              variant={statusFilter === "all" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "all")}>
              All
            </Button>
            <Button
              variant={statusFilter === "open" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "open")}
              class="gap-1">
              <GitCommit class="h-3 w-3" /> Open
            </Button>
            <Button
              variant={statusFilter === "applied" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "applied")}
              class="gap-1">
              <Check class="h-3 w-3" /> Applied
            </Button>
            <Button
              variant={statusFilter === "closed" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "closed")}
              class="gap-1">
              <X class="h-3 w-3" /> Closed
            </Button>
            <Button
              variant={statusFilter === "draft" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "draft")}
              class="gap-1">
              <Clock class="h-3 w-3" /> Draft
            </Button>
          </div>
        </div>

        <!-- Sort Options -->
        <div>
          <h3 class="mb-2 text-sm font-medium">Sort By</h3>
          <div class="flex flex-wrap gap-2">
            <Button
              variant={sortBy === "newest" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortBy = "newest")}
              class="gap-1">
              <CalendarDays class="h-3 w-3" /> Newest
            </Button>
            <Button
              variant={sortBy === "oldest" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortBy = "oldest")}
              class="gap-1">
              <CalendarDays class="h-3 w-3" /> Oldest
            </Button>
            <Button
              variant={sortBy === "status" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortBy = "status")}
              class="gap-1">
              <Check class="h-3 w-3" /> Status
            </Button>
            <Button
              variant={sortBy === "commits" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortBy = "commits")}
              class="gap-1">
              <GitCommit class="h-3 w-3" /> Commits
            </Button>
          </div>
        </div>

        <!-- Author Filter -->
        {#if uniqueAuthors.size > 1}
          <div class="md:col-span-2">
            <h3 class="mb-2 text-sm font-medium">Author</h3>
            <div class="flex flex-wrap gap-2">
              <Button
                variant={authorFilter === "" ? "default" : "outline"}
                size="sm"
                onclick={() => (authorFilter = "")}>
                All Authors
              </Button>

              {#each uniqueAuthors as author}
                <Button
                  variant={authorFilter === author ? "default" : "outline"}
                  size="sm"
                  onclick={() => (authorFilter = author!)}
                  class="gap-1">
                  <User class="h-3 w-3" />
                  <span class="text-sm"><ProfileName pubkey={author!} /></span>
                </Button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="flex flex-col items-center justify-center py-12">
      <Spinner {loading}>
        {#if loading}
          Loading patches….
        {:else}
          End of patches history
        {/if}
      </Spinner>
    </div>
  {:else if searchedPatches.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      No patches found.
    </div>
  {:else}
    <div class="flex flex-col gap-y-4 overflow-y-auto">
      {#key searchedPatches}
        {#each searchedPatches as patch (patch.id)}
          <div in:fly={slideAndFade({duration: 200})}>
            <PatchCard
              event={patch}
              patches={patch.patches}
              status={patch.status as StatusEvent}
              comments={patch.comments}
              currentCommenter={$pubkey!}
              {onCommentCreated} />
          </div>
        {/each}
      {/key}
    </div>
  {/if}
</div>
