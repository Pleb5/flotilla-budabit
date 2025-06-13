<script lang="ts">
  import {Repo, RepoHeader, RepoTab} from "@nostr-git/ui"
  import {page} from "$app/stores"
  import {decodeRelay, deriveNaddrEvent, hasNip29, userMembership} from "@app/state"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import {FileCode, GitBranch, CircleAlert, GitPullRequest, Layers, GitMerge} from "@lucide/svelte"
  import {
    parseRepoAnnouncementEvent,
    type CommentEvent,
    type IssueEvent,
    type RepoAnnouncementEvent,
    type RepoStateEvent,
  } from "@nostr-git/shared-types"
  import {setContext} from "svelte"
  import {deriveEvents} from "@welshman/store"
  import {deriveProfile, deriveRelay, publishThunk, repository} from "@welshman/app"
  import {GIT_REPO_STATE} from "@src/lib/util"
  import {derived as _derived, get} from "svelte/store"
  import {Address, GIT_ISSUE, GIT_PATCH, type Filter} from "@welshman/util"
  import {load} from "@welshman/net"
  import {equals, nthEq} from "@welshman/lib"
  import {nip19, type NostrEvent} from "nostr-tools"
  import type {AddressPointer} from "nostr-tools/nip19"
  import {addRoomMembership, getThunkError, nip29} from "@src/app/commands"
  import {pushToast} from "@src/app/toast"
  import {makeSpacePath} from "@src/app/routes"
  import {goto} from "$app/navigation"
  import {toast} from "@nostr-git/ui"

  const {id, relay} = $page.params

  let {children} = $props()

  const decoded = nip19.decode(id).data as AddressPointer
  const repoId = decoded.identifier

  let eventStore = deriveNaddrEvent(id, Array.isArray(relay) ? relay : [relay])

  const repoState = $derived.by(() => {
    if ($eventStore) {
      const repoEvent = parseRepoAnnouncementEvent($eventStore as RepoAnnouncementEvent)
      const address = repoEvent.repoId

      const repoStateFilter: Filter[] = [
        {
          kinds: [GIT_REPO_STATE],
          "#d": [address!],
        },
      ]
      return deriveEvents(repository, {filters: repoStateFilter})
    }
  })

  const issues = $derived.by(() => {
    if ($eventStore) {
      return deriveEvents(repository, {
        filters: [
          {
            kinds: [GIT_ISSUE],
            "#a": [Address.fromEvent($eventStore).toString()],
          },
        ],
      })
    }
  })

  const patches = $derived.by(() => {
    if ($eventStore) {
      return deriveEvents(repository, {
        filters: [
          {
            kinds: [GIT_PATCH],
            "#a": [Address.fromEvent($eventStore).toString()],
            "#t": ["root"],
          },
        ],
      })
    }
  })

  const url = decodeRelay($page.params.relay)

  const relays = $derived.by(() => {
    if ($eventStore) {
      const [_, ...relays] = $eventStore.tags.find(nthEq(0, "relays")) || []
      return [url, ...relays]
    }
  })

  const postComment = (comment: CommentEvent) => {
    publishThunk({
      relays: [url],
      event: comment,
    })
  }

  setContext("postComment", postComment)

  const postIssue = (issue: IssueEvent) => {
    publishThunk({
      relays: [url],
      event: issue,
    })
  }

  setContext("getProfile", deriveProfile)

  let activeTab: string | undefined = $page.url.pathname.split("/").pop()
  const encodeddRelay = encodeURIComponent(relay)

  $effect(() => {
    if ($eventStore) {
      const address = Address.fromEvent($eventStore).toString()
      const repoStateFilter: Filter = {kinds: [GIT_REPO_STATE], "#d": [address]}
      const issuesFilter: Filter = {kinds: [GIT_ISSUE], "#a": [address]}
      const patchesFilter: Filter = {kinds: [GIT_PATCH], "#a": [address]}

      load({
        relays: relays!,
        filters: [issuesFilter, patchesFilter, repoStateFilter],
      })
    }
  })

  const nipRelay = deriveRelay(url)

  const isRepoWatched = $derived.by(() => {
    const list = get(userMembership)
    const pred = (t: string[]) => equals(["group", repoId, url], t.slice(0, 3))
    const room = list?.publicTags.find(pred)
    return room !== undefined && room.length > 0
  })

  const watchRepo = async () => {
    $eventStore.tags.push(["h", id])
    console.log($eventStore)

    const publish = publishThunk({
      relays: [url],
      event: {
        content: $eventStore.content,
        tags: $eventStore.tags,
        kind: $eventStore.kind,
        pubkey: $eventStore.pubkey,
      },
    })

    const message = await getThunkError(publish)

    if (message) {
      return pushToast({theme: "error", message})
    }

    if (hasNip29($nipRelay)) {
      const createMessage = await getThunkError(nip29.createRoom(url, id))

      if (createMessage && !createMessage.match(/^duplicate:|already a member/)) {
        return pushToast({theme: "error", message: createMessage})
      }

      const editMessage = await getThunkError(nip29.editMeta(url, id, {repoId}))

      if (editMessage) {
        return pushToast({theme: "error", message: editMessage})
      }

      const joinMessage = await getThunkError(nip29.joinRoom(url, id))

      if (joinMessage && !joinMessage.includes("already")) {
        return pushToast({theme: "error", message: joinMessage})
      }
    }
    addRoomMembership(url, id, repoId)
    goto(makeSpacePath(url, id))
  }

  // Connect the nostr-git toast store to the toast component
  $effect(() => {
    if ($toast.length > 0) {
      $toast.forEach(t => {
        pushToast({message: t.description!, theme: t.variant === "error" ? "error" : undefined})
      })
      toast.clear()
    }
  })

  const repoClass = new Repo({
    repoEvent: $eventStore as RepoAnnouncementEvent,
    repoStateEvent: $repoState[0] as RepoStateEvent,
    publish: (event: NostrEvent) => {
      return publishThunk({
        relays: [url],
        event: event,
      })
    },
    issues: $issues,
    patches: $patches,
  })

  setContext("repoClass", repoClass)
</script>

<PageContent class="flex flex-grow flex-col gap-2 overflow-auto p-8">
  {#if $eventStore === undefined}
    <div class="p-4 text-center">Loading repository...</div>
  {:else if !$eventStore}
    <div class="p-4 text-center text-red-500">Repository not found.</div>
  {:else}
    <RepoHeader
      event={$eventStore as RepoAnnouncementEvent}
      {activeTab}
      {watchRepo}
      {isRepoWatched}>
      {#snippet children(activeTab: string)}
        <RepoTab
          tabValue={id}
          label="Overview"
          href={`/spaces/${encodeddRelay}/git/${id}`}
          {activeTab}>
          {#snippet icon()}
            <FileCode class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="code"
          label="Code"
          href={`/spaces/${encodeddRelay}/git/${id}/code`}
          {activeTab}>
          {#snippet icon()}
            <GitBranch class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="issues"
          label="Issues"
          href={`/spaces/${encodeddRelay}/git/${id}/issues`}
          {activeTab}>
          {#snippet icon()}
            <CircleAlert class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="patches"
          label="Patches"
          href={`/spaces/${encodeddRelay}/git/${id}/patches`}
          {activeTab}>
          {#snippet icon()}
            <GitPullRequest class="h-4 w-4" />
          {/snippet}
        </RepoTab>
      {/snippet}
    </RepoHeader>
    {@render children()}
  {/if}
</PageContent>
