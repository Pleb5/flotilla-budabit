<script lang="ts">
  import {formatTimestamp} from "@welshman/lib"
  import {getTag, getIdFilters} from "@welshman/util"
  import {load, LOCAL_RELAY_URL} from "@welshman/net"
  import type {TrustedEvent} from "@welshman/util"
  import {pubkey, repository, retryThunk, waitForAnyRelayAck} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import Profile from "@app/components/Profile.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import NoteContent from "@app/components/NoteContent.svelte"
  import ReportMenu from "@app/components/ReportMenu.svelte"
  import {publishDelete} from "@app/core/commands"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {goToEvent} from "@app/util/routes"

  type Props = {
    url: string
    event: TrustedEvent
    onDelete?: () => void
  }

  const {url, event, onDelete}: Props = $props()
  const failedDeleteThunks = new Map<string, ReturnType<typeof publishDelete>>()

  const etag = getTag("e", event.tags)
  const ptag = getTag("p", event.tags)
  const reason = etag?.[2] || ptag?.[2]

  const onClick = (e: Event, event: TrustedEvent) => {
    // @ts-ignore
    if (e.target?.classList.contains("profile-name")) {
      pushModal(ProfileDetail, {pubkey: event.pubkey, url})
    } else {
      goToEvent(event)
    }
  }

  const deleteReport = async () => {
    if (isDeleting) return

    const deleteKey = JSON.stringify({eventId: event.id, relays: [url]})
    let thunk = failedDeleteThunks.get(deleteKey)
    isDeleting = true

    try {
      if (thunk) {
        thunk = retryThunk(thunk) as ReturnType<typeof publishDelete>
      } else {
        thunk = publishDelete({event, relays: [url], optimistic: false})
      }

      await waitForAnyRelayAck(thunk, thunk.options.relays)
    } catch (error) {
      if (thunk) failedDeleteThunks.set(deleteKey, thunk)
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Failed to delete this report.",
      })
      return
    } finally {
      isDeleting = false
    }

    failedDeleteThunks.clear()
    repository.publish(thunk.event as TrustedEvent)
    onDelete?.()
  }

  let isDeleting = $state(false)
</script>

<div class="column gap-4">
  <div class="flex justify-between">
    <div>
      <Profile pubkey={event.pubkey} {url} avatarSize={5} />
      <span>
        Reported this event
        {#if reason}
          as "{reason}"
        {/if}
      </span>
    </div>
    {#if event.pubkey === $pubkey}
      <Button class="btn-default btn" onclick={deleteReport} disabled={isDeleting}>
        Delete Report
      </Button>
    {:else}
      <ReportMenu {url} {event} />
    {/if}
  </div>
  {#if event.content}
    <div class="border-l-2 border-primary pl-3">
      <NoteContent {event} />
    </div>
  {/if}
  <div class="card2 card2-sm bg-alt">
    {#if etag}
      {#await load({relays: [url, LOCAL_RELAY_URL], filters: getIdFilters([etag[1]])})}
        <p>Loading</p>
      {:then reportedEvents}
        {#if reportedEvents.length === 0}
          <p>Unable to find reported note.</p>
        {:else}
          {@const event = reportedEvents[0]}
          <Button class="col-2 w-full" onclick={(e: Event) => onClick(e, event)}>
            <div class="flex items-center justify-between gap-2">
              <span class="profile-name">
                @<ProfileName pubkey={event.pubkey} {url} />
              </span>
              <span class="text-xs opacity-75">
                {formatTimestamp(event.created_at)}
              </span>
            </div>
            <NoteContent {event} />
          </Button>
        {/if}
      {/await}
    {:else if ptag}
      <Profile pubkey={ptag[1]} />
    {/if}
  </div>
</div>
