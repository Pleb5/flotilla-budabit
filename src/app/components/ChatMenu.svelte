<script lang="ts">
  import {waitForThunkCompletion} from "@welshman/app"
  import ChatSquare from "@assets/icons/chat-square.svg?dataurl"
  import Check from "@assets/icons/check.svg?dataurl"
  import Bell from "@assets/icons/bell.svg?dataurl"
  import BellOff from "@assets/icons/bell-off.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import ChatStart from "@app/components/ChatStart.svelte"
  import {setChecked} from "@app/util/notifications"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {dmAlert, userInboxRelays, NOTIFIER_RELAY, NOTIFIER_PUBKEY} from "@app/core/state"
  import {publishAlert, publishDelete} from "@app/core/commands"
  import {getThunkError} from "@welshman/app"

  const startChat = () => pushModal(ChatStart, {}, {replaceState: true})

  const markAsRead = () => {
    setChecked("/chat/*")
    history.back()
  }

  const enableAlerts = async () => {
    if ($userInboxRelays.length === 0) {
      return pushToast({
        theme: "error",
        message: "Please set up your messaging relays before enabling alerts.",
      })
    }

    enablingAlert = true

    try {
      const feed = {kinds: ["DM"], relays: []} as any
      const description = "Direct message notifications"
      const web = undefined
      const ios = undefined
      const android = undefined
      const email = undefined

      const thunk = await publishAlert({feed, description, web, ios, android, email})
      await thunk.result
      const error = await getThunkError(thunk)
      if (error) {
        return pushToast({theme: "error", message: error})
      }
    } finally {
      enablingAlert = false
    }
  }

  const disableAlerts = async () => {
    disablingAlert = true

    try {
      const thunk = publishDelete({
        event: $dmAlert!.event,
        relays: [NOTIFIER_RELAY],
        tags: [["p", NOTIFIER_PUBKEY]],
      })
      await waitForThunkCompletion(thunk)
    } finally {
      disablingAlert = false
    }
  }

  let enablingAlert = $state(false)
  let disablingAlert = $state(false)
</script>

<div class="col-2">
  <Button class="btn btn-primary" onclick={startChat}>
    <Icon size={5} icon={ChatSquare} />
    Start chat
  </Button>
  <Button class="btn btn-neutral" onclick={markAsRead}>
    <Icon size={5} icon={Check} />
    Mark all read
  </Button>
  {#if (!enablingAlert && $dmAlert) || disablingAlert}
    <Button class="btn btn-neutral" onclick={disableAlerts} disabled={disablingAlert}>
      {#if !disablingAlert}
        <Icon size={4} icon={BellOff} />
      {/if}
      <Spinner loading={disablingAlert}>Disable alerts</Spinner>
    </Button>
  {:else}
    <Button class="btn btn-neutral" onclick={enableAlerts} disabled={enablingAlert}>
      {#if !enablingAlert}
        <Icon size={4} icon={Bell} />
      {/if}
      <Spinner loading={enablingAlert}>Enable alerts</Spinner>
    </Button>
  {/if}
</div>
