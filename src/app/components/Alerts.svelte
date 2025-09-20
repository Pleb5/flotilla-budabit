<script lang="ts">
  import {sleep} from "@welshman/lib"
  import {getTagValue, getAddress} from "@welshman/util"
  import Inbox from "@assets/icons/inbox.svg?dataurl"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import AlertAdd from "@app/components/AlertAdd.svelte"
  import AlertItem from "@app/components/AlertItem.svelte"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {alerts, dmAlert, deriveAlertStatus, userInboxRelays, getAlertFeed, NOTIFIER_RELAY, NOTIFIER_PUBKEY} from "@app/core/state"
  import {publishAlert, publishDelete} from "@app/core/commands"
  import {getThunkError} from "@welshman/app"

  type Props = {
    url?: string
    channel?: string
    hideSpaceField?: boolean
  }

  const {url = "", channel = "push", hideSpaceField = false}: Props = $props()

  const dmStatus = $derived($dmAlert ? deriveAlertStatus(getAddress($dmAlert.event)) : undefined)

  const filteredAlerts = $derived(
    $alerts.filter(alert => {
      const feed = getAlertFeed(alert)

      // Skip non-feeds and DM alerts
      if (!feed || alert === $dmAlert) return false

      // If we have a space url, only match feeds that reference this url (best-effort)
      if (url) return JSON.stringify(feed).includes(url)

      return true
    }),
  )

  const startAlert = () => pushModal(AlertAdd, {url, channel, hideSpaceField})

  const uncheckDmAlert = async (message: string) => {
    await sleep(100)

    toggle.checked = false
    pushToast({theme: "error", message})
  }

  const onToggle = async () => {
    if ($dmAlert) {
      publishDelete({event: $dmAlert.event, relays: [NOTIFIER_RELAY], tags: [["p", NOTIFIER_PUBKEY]]})
    } else {
      if ($userInboxRelays.length === 0) {
        return uncheckDmAlert("Please set up your messaging relays before enabling alerts.")
      }

      // Create a minimal DM alert using publishAlert
      const feed = {kinds: ["DM"], relays: []} as any
      const description = "Direct message notifications"
      const web = undefined
      const ios = undefined
      const android = undefined
      const email = undefined

      {
        const thunk = await publishAlert({feed, description, web, ios, android, email})
        await thunk.result
        const error = await getThunkError(thunk)
        if (error) {
          return uncheckDmAlert(String(error))
        }
      }

      pushToast({message: "Your alert has been successfully created!"})
    }
  }

  let toggle: HTMLInputElement
</script>

<div class="col-4">
  <div class="card2 bg-alt flex flex-col gap-6 shadow-xl">
    <div class="flex items-center justify-between">
      <strong class="flex items-center gap-3">
        <Icon icon={Inbox} />
        Alerts
      </strong>
      <Button class="btn btn-primary btn-sm" onclick={startAlert}>
        <Icon icon={AddCircle} />
        Add Alert
      </Button>
    </div>
    <div class="col-4">
      {#each filteredAlerts as alert (alert.event.id)}
        <AlertItem {alert} />
      {:else}
        <p class="text-center opacity-75 py-12">Nothing here yet!</p>
      {/each}
    </div>
  </div>
  <div class="card2 bg-alt flex flex-col gap-4 shadow-xl">
    <div class="flex justify-between">
      <p>Notify me about new direct messages</p>
      <input
        type="checkbox"
        class="toggle toggle-primary"
        bind:this={toggle}
        checked={Boolean($dmAlert)}
        oninput={onToggle} />
    </div>
    {#if $dmStatus}
      {@const status = getTagValue("status", $dmStatus.tags) || "error"}
      {#if status !== "ok"}
        <div class="alert alert-error border border-solid border-error bg-transparent text-error">
          <p>
            {getTagValue("message", $dmStatus.tags) ||
              "The notification server did not respond to your request."}
          </p>
        </div>
      {/if}
    {/if}
  </div>
</div>
