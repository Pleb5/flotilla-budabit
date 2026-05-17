<script lang="ts">
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {publishThunk, pubkey} from "@welshman/app"
  import {makeEvent, THREAD} from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Field from "@lib/components/Field.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {makeCommunityForumThread} from "@app/core/community-forum"
  import {COMMUNITY_WRITE_TARGETS, canWriteCommunityTarget} from "@app/core/community-permissions"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const threadsPath = $derived(communityPubkey ? makeCommunityPath(communityPubkey, "threads") : "")
  const communityBootstrapReady = $derived(
    Boolean(
      communityPubkey &&
        $activeCommunityDefinition?.pubkey === communityPubkey &&
        $activeCommunityBootstrapStatus.loaded &&
        !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const canCreateThread = $derived(
    Boolean(
      $pubkey &&
        communityBootstrapReady &&
        $activeCommunityDefinition &&
        canWriteCommunityTarget({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          userPubkey: $pubkey,
          target: COMMUNITY_WRITE_TARGETS.forumThread,
        }),
    ),
  )

  const createThread = () => {
    const trimmedTitle = title.trim()
    const trimmedContent = content.trim()
    if (!communityPubkey || !trimmedTitle || !trimmedContent) return
    if (!communityBootstrapReady) {
      pushToast({theme: "error", message: "Community permissions are still loading."})
      return
    }
    if (!canCreateThread) {
      pushToast({theme: "error", message: "You do not have permission to create forum threads."})
      return
    }

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
    pushToast({message: "Thread published."})
    if (threadsPath) goto(threadsPath)
  }

  let title = $state("")
  let content = $state("")
</script>

<PageBar>
  {#snippet icon()}
    <div>
      <a href={threadsPath || "#"} class="btn btn-neutral btn-sm">
        <Icon icon={AltArrowLeft} />
      </a>
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Create a Thread</strong>
  {/snippet}
  {#snippet action()}
    <CommunityMenuButton community={communityPubkey} />
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
        <textarea bind:value={content} class="textarea textarea-bordered" rows="8"></textarea>
      {/snippet}
    </Field>
    <div class="flex justify-end">
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.forumThread}
        action="create forum threads"
        submit
        disabled={!title.trim() || !content.trim()}>
        Create thread
      </PublishGate>
    </div>
  </form>
</PageContent>
