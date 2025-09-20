<script lang="ts">
  import {goto} from "$app/navigation"
  import {uniqBy, nth} from "@welshman/lib"
  import {displayRelayUrl, makeRoomMeta} from "@welshman/util"
  import {deriveRelay, createRoom, editRoom, joinRoom, getThunkError} from "@welshman/app"
  import {preventDefault} from "@lib/html"
  import Field from "@lib/components/Field.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import Danger from "@assets/icons/danger-triangle.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import {hasNip29, loadChannel} from "@app/core/state"
  import {makeSpacePath} from "@app/routes"
  import {pushToast} from "@app/util/toast"

  const {url} = $props()

  const room = makeRoomMeta()
  const relay = deriveRelay(url)

  const back = () => history.back()

  const tryCreate = async () => {
    room.tags = uniqBy(nth(0), [...room.tags, ["name", name]])

    {
      const thunk = createRoom(url, room)
      await thunk.result
      const createMessage = await getThunkError(thunk)

      if (createMessage && !createMessage.match(/^duplicate:|already a member/)) {
        return pushToast({theme: "error", message: createMessage})
      }
    }

    {
      const thunk = editRoom(url, room)
      await thunk.result
      const editMessage = await getThunkError(thunk)
      if (editMessage) {
        return pushToast({theme: "error", message: editMessage})
      }
    }

    {
      const thunk = joinRoom(url, room)
      await thunk.result
      const joinMessage = await getThunkError(thunk)
      if (joinMessage && !joinMessage.includes("already")) {
        return pushToast({theme: "error", message: joinMessage})
      }
    }

    await loadChannel(url, room.id)

    goto(makeSpacePath(url, room.id))
  }

  const create = async () => {
    loading = true

    try {
      await tryCreate()
    } finally {
      loading = false
    }
  }

  let name = $state("")
  let loading = $state(false)
</script>

<form class="column gap-4" onsubmit={preventDefault(create)}>
  <ModalHeader>
    {#snippet title()}
      <div>Create a Room</div>
    {/snippet}
    {#snippet info()}
      <div>
        On <span class="text-primary">{displayRelayUrl(url)}</span>
      </div>
    {/snippet}
  </ModalHeader>
  <Field>
    {#snippet label()}
      <p>Room Name</p>
    {/snippet}
    {#snippet input()}
      <label class="input input-bordered flex w-full items-center gap-2">
        <Icon icon="hashtag" />
        <input bind:value={name} class="grow" type="text" />
      </label>
    {/snippet}
  </Field>
  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={!name || loading}>
      <Spinner {loading}>Create Room</Spinner>
      <Icon icon={AltArrowRight} />
    </Button>
  </ModalFooter>
</form>
