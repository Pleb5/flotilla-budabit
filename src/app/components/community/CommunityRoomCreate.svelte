<script lang="ts">
  import {goto} from "$app/navigation"
  import {pubkey, publishThunk} from "@welshman/app"
  import {makeEvent, THREAD} from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {preventDefault} from "@lib/html"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import {makeCommunityRoomRoot} from "@app/core/community-rooms"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
  } from "@app/core/community-state"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunityWriteTargetSectionName,
  } from "@app/core/community-permissions"
  import {getCommunityScopedPublishRelays} from "@app/core/community-relays"
  import {pushToast} from "@app/util/toast"
  import {formatShortNpub} from "@app/util/pubkeys"
  import {makeCommunityRoomPath} from "@app/util/routes"

  type Props = {
    communityPubkey: string
  }

  const {communityPubkey}: Props = $props()
  const communityLabel = $derived(formatShortNpub(communityPubkey) || "this community")
  const communityBootstrapReady = $derived(
    Boolean(
      communityPubkey &&
      $activeCommunityDefinition?.pubkey === communityPubkey &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const canCreateRoom = $derived(
    Boolean(
      $pubkey &&
      communityBootstrapReady &&
      $activeCommunityDefinition &&
      canWriteCommunityTarget({
        definition: $activeCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.roomRoot,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const communityPublishRelays = $derived(
    getCommunityScopedPublishRelays($activeCommunityDefinition),
  )
  const roomRootSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityBootstrapReady ? $activeCommunityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.roomRoot,
    ),
  )
  const roomRootAccessMessage = $derived(`Request ${roomRootSectionName} access to create rooms.`)

  const back = () => history.back()

  const createRoom = () => {
    const trimmed = roomName.trim()
    if (!trimmed || loading) return
    if (!communityBootstrapReady) {
      pushToast({theme: "error", message: "Community permissions are still loading."})
      return
    }
    if (!canCreateRoom) {
      pushToast({theme: "error", message: roomRootAccessMessage})
      return
    }
    if (communityPublishRelays.length === 0) {
      pushToast({theme: "error", message: "Community definition must declare at least one relay."})
      return
    }

    loading = true
    const event = makeEvent(
      THREAD,
      makeCommunityRoomRoot({
        communityPubkey,
        name: trimmed,
        about: roomDescription.trim(),
      }),
    )

    const thunk = publishThunk({relays: communityPublishRelays, event})

    pushToast({message: "Room published."})
    void goto(makeCommunityRoomPath(communityPubkey, thunk.event.id), {replaceState: true})
  }

  let roomName = $state("")
  let roomDescription = $state("")
  let loading = $state(false)
</script>

<form class="column gap-4" onsubmit={preventDefault(createRoom)}>
  <ModalHeader>
    {#snippet title()}
      <div>Create a Room</div>
    {/snippet}
    {#snippet info()}
      <div>In <span class="text-primary">{communityLabel}</span></div>
    {/snippet}
  </ModalHeader>

  {#if communityBootstrapLoading}
    <p class="flex items-center justify-center py-8 text-sm opacity-70">
      <Spinner loading>Loading room creation permissions...</Spinner>
    </p>
  {:else if canCreateRoom}
    <Field>
      {#snippet label()}
        <p>Name</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={Hashtag} />
          <input bind:value={roomName} class="grow" type="text" />
        </label>
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        <p>Description</p>
      {/snippet}
      {#snippet input()}
        <textarea bind:value={roomDescription} class="textarea textarea-bordered" rows="4"
        ></textarea>
      {/snippet}
    </Field>
  {:else}
    <div class="rounded-box bg-base-200 p-4">
      <strong>Access required</strong>
      <p class="mt-1 text-sm opacity-70">{roomRootAccessMessage}</p>
      <div class="mt-3 flex justify-end">
        <PublishGate
          target={COMMUNITY_WRITE_TARGETS.roomRoot}
          action="create rooms"
          compact
          class="btn btn-primary" />
      </div>
    </div>
  {/if}

  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    {#if canCreateRoom}
      <Button type="submit" class="btn btn-primary" disabled={!roomName.trim() || loading}>
        <Spinner {loading}>Create Room</Spinner>
        <Icon icon={AltArrowRight} />
      </Button>
    {/if}
  </ModalFooter>
</form>
