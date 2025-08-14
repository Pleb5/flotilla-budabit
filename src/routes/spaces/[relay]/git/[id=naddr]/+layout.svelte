<script lang="ts">
  import {RepoHeader, RepoTab, toast} from "@nostr-git/ui"
  import {ConfigProvider} from "@nostr-git/ui"
  import {FileCode, GitBranch, CircleAlert, GitPullRequest, GitCommit, Layers} from "@lucide/svelte"
  import {page} from "$app/stores"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import Avatar from "@lib/components/Avatar.svelte"
  import Profile from "@src/app/components/Profile.svelte"
  import ProfileLink from "@src/app/components/ProfileLink.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import Input from "@lib/components/Field.svelte"
  import Dialog from "@lib/components/Dialog.svelte"
  import {pushToast} from "@src/app/toast"
  import EventActions from "@src/app/components/EventActions.svelte"
  import ReactionSummary from "@src/app/components/ReactionSummary.svelte"
  import {pushModal} from "@app/modal"
  import {EditRepoPanel, ForkRepoDialog} from "@nostr-git/ui"
  import {postRepoAnnouncement} from "@src/app/commands.js"
  import type {RepoAnnouncementEvent} from "@nostr-git/shared-types"
  import { derived as _derived } from "svelte/store"
  import { repository, pubkey } from "@welshman/app"
  import { deriveEvents } from "@welshman/store"
  import { load } from "@welshman/net"
  import { Router } from "@welshman/router"
  import { GRASP_SET_KIND, DEFAULT_GRASP_SET_ID, parseGraspServersEvent } from "@nostr-git/core"
    import { goto } from "$app/navigation"

  const {id, relay} = $page.params

  let {data, children} = $props()
  const {repoClass} = data

  let activeTab: string | undefined = $page.url.pathname.split("/").pop()
  const encodedRelay = encodeURIComponent(relay)

  // Refresh state
  let isRefreshing = $state(false)

  // --- GRASP servers (user profile) ---
  const graspServersFilter = {
    kinds: [GRASP_SET_KIND],
    authors: [pubkey.get()!],
    "#d": [DEFAULT_GRASP_SET_ID],
  }

  const graspServersEvent = _derived(
    deriveEvents(repository, { filters: [graspServersFilter] }),
    (events) => {
      if (events.length === 0) {
        load({ relays: Router.get().FromUser().getUrls(), filters: [graspServersFilter] })
      }
      return events[0]
    }
  )

  let graspServerUrls = $state<string[]>([])
  graspServersEvent.subscribe((ev) => {
    try {
      graspServerUrls = ev ? (parseGraspServersEvent(ev as any) as string[]) : []
    } catch {
      graspServerUrls = []
    }
  })

  // Refresh repository function
  async function refreshRepo() {
    if (!repoClass || isRefreshing) return

    isRefreshing = true

    try {
      // Get clone URLs from the repo event
      const cloneUrls = repoClass.repoEvent.tags
        .filter((tag: string[]) => tag[0] === "clone")
        .map((tag: string[]) => tag[1])
        .filter(Boolean)

      if (cloneUrls.length === 0) {
        throw new Error("No clone URLs found for repository")
      }

      // Call syncWithRemote through the repo's worker manager
      const result = await repoClass.workerManager.syncWithRemote({
        repoId: repoClass.canonicalKey,
        cloneUrls,
        branch: repoClass.mainBranch,
      })

      if (result.success) {
        // Show success toast
        pushToast({
          message: `Repository synced with remote (${result.headCommit?.slice(0, 8)})`,
        })

        // Reset the repo to refresh all cached data
        await repoClass.reset()
      } else {
        throw new Error(result.error || "Sync failed")
      }
    } catch (error) {
      console.error("Failed to refresh repository:", error)
      pushToast({
        message: `Failed to sync repository: ${error instanceof Error ? error.message : "Unknown error"}`,
        theme: "error",
      })
    } finally {
      isRefreshing = false
    }
  }

  function forkRepo() {
    if (!repoClass || !repoClass.repo) return
    
    pushModal(ForkRepoDialog, {
      repo: repoClass,
      onPublishEvent: (event: any) => {
        // Handle event publishing
        postRepoAnnouncement(event, [])
      },
      graspServerUrls: graspServerUrls
    })
  }

  function settingsRepo() {
    if (!repoClass) return
    pushModal(EditRepoPanel, {
      repo: repoClass,
      onPublishEvent: (event: RepoAnnouncementEvent) => {
        postRepoAnnouncement(event, [])
      },
    })
  }

  function overviewRepo() {
    if (!repoClass) return
    goto(`/spaces/${relay}/git/${id}/`)
  }

  // Connect the nostr-git toast store to the toast component
  $effect(() => {
    if ($toast.length > 0) {
      $toast.forEach(t => {
        // The toast store now handles format conversion internally
        pushToast({
          message:
            t.message ||
            (t.title && t.description
              ? `${t.title}: ${t.description}`
              : t.title || t.description || ""),
          timeout: t.timeout || t.duration,
          theme: t.theme || (t.variant === "destructive" ? "error" : undefined),
        })
      })
      toast.clear()
    }
  })
  
</script>

<PageContent class="flex flex-grow flex-col gap-2 overflow-auto p-8">
  {#if repoClass === undefined}
    <div class="p-4 text-center">Loading repository...</div>
  {:else if !repoClass}
    <div class="p-4 text-center text-red-500">Repository not found.</div>
  {:else}
    <RepoHeader
      event={repoClass.repoEvent}
      {activeTab}
      isRepoWatched={false}
      {refreshRepo}
      {isRefreshing}
      {forkRepo}
      {settingsRepo}
      {overviewRepo}
      >
      {#snippet children(activeTab: string)}
        <RepoTab
          tabValue="feed"
          label="Feed"
          href={`/spaces/${encodedRelay}/git/${id}/feed`}
          {activeTab}>
          {#snippet icon()}
            <FileCode class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="code"
          label="Code"
          href={`/spaces/${encodedRelay}/git/${id}/code`}
          {activeTab}>
          {#snippet icon()}
            <GitBranch class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="issues"
          label="Issues"
          href={`/spaces/${encodedRelay}/git/${id}/issues`}
          {activeTab}>
          {#snippet icon()}
            <CircleAlert class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="patches"
          label="Patches"
          href={`/spaces/${encodedRelay}/git/${id}/patches`}
          {activeTab}>
          {#snippet icon()}
            <GitPullRequest class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="commits"
          label="Commits"
          href={`/spaces/${encodedRelay}/git/${id}/commits`}
          {activeTab}>
          {#snippet icon()}
            <GitCommit class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="workbench"
          label="Workbench"
          href={`/spaces/${encodedRelay}/git/${id}/workbench`}
          {activeTab}>
          {#snippet icon()}
            <Layers class="h-4 w-4" />
          {/snippet}
        </RepoTab>
      {/snippet}
    </RepoHeader>
    <ConfigProvider
      components={{
        AvatarImage: Avatar as typeof import("@nostr-git/ui").AvatarImage,
        Separator: Divider as typeof import("@nostr-git/ui").Separator,
        Input: Input as typeof import("@nostr-git/ui").Input,
        Alert: Dialog as typeof import("@nostr-git/ui").Alert,
        ProfileComponent: Profile as typeof import("@nostr-git/ui").Profile,
        ProfileLink: ProfileLink as typeof import("@nostr-git/ui").ProfileLink,
        EventActions: EventActions as typeof import("@nostr-git/ui").EventActions,
        ReactionSummary: ReactionSummary as typeof import("@nostr-git/ui").ReactionSummary,
      }}>
      {@render children()}
    </ConfigProvider>
  {/if}
</PageContent>
