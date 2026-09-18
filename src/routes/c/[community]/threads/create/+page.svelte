<script lang="ts">
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {pubkey} from "@welshman/app"
  import {makeEvent, prep, THREAD} from "@welshman/util"
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
    activeCommunityDescriptor,
    activeExactCommunityDefinition,
    activeCommunityProfileListEvents,
    activeExactCommunityPublishRelays,
    activeCommunityReportState,
  } from "@app/core/community-state"
  import {makeCommunityThread} from "@app/core/community-threads"
  import {startPublication} from "@app/core/publication-operations"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunityWriteTargetSectionName,
  } from "@app/core/community-permissions"
  import {makeExactCommunityThreadPath, parseExactCommunityRouteParam} from "@app/util/routes"

  const routeCommunity = $derived(parseExactCommunityRouteParam($page.params.community))
  const communityOwnerPubkey = $derived(routeCommunity?.ownerPubkey || "")
  const communityId = $derived(routeCommunity?.communityId || "")
  const communityAddress = $derived(routeCommunity?.address || "")
  const communityDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityAddress
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const threadsPath = $derived(routeCommunity ? makeExactCommunityThreadPath(routeCommunity) : "")
  const communityBootstrapReady = $derived(
    Boolean(
      communityAddress &&
      communityDefinition &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityAuthorityReadiness = $derived(
    $activeCommunityDescriptor?.community.address === communityAddress
      ? $activeCommunityDescriptor.authorityReadiness.state
      : "loading",
  )
  const communityReady = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "ready",
  )
  const threadSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityReady ? communityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.thread,
    ),
  )
  const threadAccessMessage = $derived(`Request ${threadSectionName} access to create threads.`)
  const canCreateThread = $derived(
    Boolean(
      $pubkey &&
      communityReady &&
      communityDefinition &&
      canWriteCommunityTarget({
        definition: communityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.thread,
        reportState: $activeCommunityReportState,
      }),
    ),
  )

  const createThread = async () => {
    const trimmedTitle = title.trim()
    const trimmedContent = content.trim()
    if (!routeCommunity || !communityId || !trimmedTitle || !trimmedContent || creating) return
    if (!communityReady) {
      pushToast({
        theme: "error",
        message:
          communityAuthorityReadiness === "unavailable"
            ? "Threads unavailable."
            : "Threads are still loading.",
      })
      return
    }
    if (!canCreateThread) {
      pushToast({theme: "error", message: threadAccessMessage})
      return
    }

    const relays = $activeExactCommunityPublishRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    creating = true

    try {
      const event = prep(
        makeEvent(
          THREAD,
          makeCommunityThread({
            communityPubkey: communityId,
            title: trimmedTitle,
            content: trimmedContent,
          }),
        ),
        $pubkey!,
      )
      startPublication({
        relays,
        event,
        label: "Community thread",
        href: makeExactCommunityThreadPath(routeCommunity, event.id),
        preview: "retain-on-failure",
      })
    } catch (error) {
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Failed to publish thread.",
      })
      return
    } finally {
      creating = false
    }

    if (threadsPath) goto(threadsPath)
  }

  let title = $state("")
  let content = $state("")
  let creating = $state(false)
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
    <CommunityMenuButton community={routeCommunity?.naddr} />
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
        target={COMMUNITY_WRITE_TARGETS.thread}
        action="create threads"
        submit
        disabled={!title.trim() || !content.trim() || creating}>
        Create thread
      </PublishGate>
    </div>
  </form>
</PageContent>
