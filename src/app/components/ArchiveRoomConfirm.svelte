<script lang="ts">
  import {displayRelayUrl, getTag, getTagValue, readRoomMeta} from "@welshman/util"
  import type {RoomMeta, TrustedEvent} from "@welshman/util"
  import {waitForThunkError} from "@welshman/app"
  import {preventDefault} from "@lib/html"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import ArchivedMinimalistic from "@assets/icons/archived-minimalistic.svg?dataurl"
  import {publishBudaBitRoomMeta, getRoomMetaRelays} from "@app/core/state"
  import {pushToast} from "@app/util/toast"
  import {clearModals} from "@app/util/modal"

  type Props = {
    url: string
    roomEvent: TrustedEvent
    roomName: string
    archived: boolean
  }

  const {url, roomEvent, roomName, archived}: Props = $props()

  const actionLabel = archived ? "Unarchive room" : "Archive room"
  const actionVerb = archived ? "unarchive" : "archive"
  const targetArchivedState = !archived
  const relays = getRoomMetaRelays(url)

  const buildRoomMeta = (event: TrustedEvent): RoomMeta => {
    try {
      return readRoomMeta(event)
    } catch {
      return {
        h: getTagValue("d", event.tags) || getTagValue("h", event.tags) || roomName,
        event,
        name: getTagValue("name", event.tags) || roomName,
        about: getTagValue("about", event.tags),
        picture: getTagValue("picture", event.tags),
        pictureMeta: getTag("picture", event.tags)?.slice(2),
        isClosed: Boolean(getTag("closed", event.tags)),
        isHidden: Boolean(getTag("hidden", event.tags)),
        isPrivate: Boolean(getTag("private", event.tags)),
        isRestricted: Boolean(getTag("restricted", event.tags)),
      }
    }
  }

  const confirm = async () => {
    if (!confirmOk) {
      pushToast({theme: "error", message: `Please type the room name to ${actionVerb}.`})
      return
    }

    loading = true

    try {
      const room = buildRoomMeta(roomEvent)
      const message = await waitForThunkError(
        publishBudaBitRoomMeta({url, room, archived: targetArchivedState, relays}),
      )

      if (message) {
        pushToast({theme: "error", message})
        return
      }

      pushToast({message: `Room ${targetArchivedState ? "archived" : "restored"}.`})
      clearModals()
    } finally {
      loading = false
    }
  }

  const back = () => history.back()

  let confirmText = $state("")
  let loading = $state(false)

  const confirmOk = $derived(roomName.trim().length > 0 && confirmText.trim() === roomName)
</script>

<form class="column gap-4" onsubmit={preventDefault(confirm)}>
  <ModalHeader>
    {#snippet title()}
      <div>{actionLabel}</div>
    {/snippet}
    {#snippet info()}
      <div>On <span class="text-primary">{displayRelayUrl(url)}</span></div>
    {/snippet}
  </ModalHeader>

  <div class="space-y-3 text-sm">
    <div class="rounded-xl border border-base-300 px-4 py-3">
      <div class="flex items-center gap-2 font-medium">
        <Icon icon={ArchivedMinimalistic} />
        {#if archived}
          Restore this room to the active room list.
        {:else}
          Move this room into archived, read-only mode.
        {/if}
      </div>
      <p class="mt-2 text-base-content/70">
        {#if archived}
          The room will appear in the normal room lists again, and posting/interactions will be re-enabled.
        {:else}
          The room will move under Archived Rooms, stay visible for reference, and open in read-only mode.
        {/if}
      </p>
      <p class="mt-2 text-xs text-base-content/60">
        This publishes updated room metadata to: {relays.join(", ") || displayRelayUrl(url)}
      </p>
    </div>

    <div>
      <div class="font-medium text-sm">Confirm {actionVerb}</div>
      <p class="text-xs text-base-content/60">
        Type the room name <strong>{roomName}</strong> to confirm.
      </p>
      <label class="input input-bordered mt-2 flex w-full items-center gap-2">
        <input bind:value={confirmText} class="grow" type="text" disabled={loading} />
      </label>
    </div>
  </div>

  <ModalFooter>
    <Button class="btn btn-link" onclick={back} disabled={loading}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={!confirmOk || loading}>
      <Spinner {loading}>{actionLabel}</Spinner>
      <Icon icon={AltArrowRight} />
    </Button>
  </ModalFooter>
</form>
