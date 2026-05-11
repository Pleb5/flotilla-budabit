<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {repository, publishThunk} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, THREAD} from "@welshman/util"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {activeCommunityRelays} from "@app/core/community-state"
  import {makeCommunityForumThreadsFilter} from "@app/core/community-feeds"
  import {makeCommunityForumThread, readCommunityForumThreads} from "@app/core/community-forum"
  import {makeCommunityThreadPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const filters = $derived(communityPubkey ? [makeCommunityForumThreadsFilter(communityPubkey)] : [])
  const events = $derived(deriveEventsAsc(deriveEventsById({repository, filters})))
  const threads = $derived(readCommunityForumThreads($events, communityPubkey))

  const createThread = () => {
    const trimmedTitle = title.trim()
    const trimmedContent = content.trim()
    if (!communityPubkey || !trimmedTitle || !trimmedContent) return

    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    publishThunk({
      relays,
      event: makeEvent(
        THREAD,
        makeCommunityForumThread({communityPubkey, title: trimmedTitle, content: trimmedContent}),
      ),
    })
    title = ""
    content = ""
    pushToast({message: "Thread published."})
  }

  let title = $state("")
  let content = $state("")

  onMount(() => {
    if (!communityPubkey || $activeCommunityRelays.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={NotesMinimalistic} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Threads</strong>
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createThread)}>
    <strong>Create thread</strong>
    <Field>
      {#snippet label()}
        <p>Title</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={NotesMinimalistic} />
          <input bind:value={title} class="grow" type="text" />
        </label>
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        <p>Message</p>
      {/snippet}
      {#snippet input()}
        <textarea bind:value={content} class="textarea textarea-bordered" rows="4"></textarea>
      {/snippet}
    </Field>
    <div class="flex justify-end">
      <Button type="submit" class="btn btn-primary" disabled={!title.trim() || !content.trim()}>
        Create thread
      </Button>
    </div>
  </form>

  <div class="col-2">
    {#each threads as thread (thread.id)}
      <a href={makeCommunityThreadPath(communityPubkey, thread.id)} class="card2 bg-alt p-4 shadow-md">
        <strong>{thread.title}</strong>
        <p class="line-clamp-2 text-sm opacity-70">{thread.content}</p>
      </a>
    {:else}
      <p class="py-8 text-center opacity-70">No threads found.</p>
    {/each}
  </div>
</PageContent>
