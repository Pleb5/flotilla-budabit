<script lang="ts">
  import {onMount} from "svelte"
  import {load} from "@welshman/net"
  import {Router} from "@welshman/router"
  import type {Filter} from "@welshman/util"
  import {deriveArray, deriveEventsById} from "@welshman/store"
  import {formatTimestampRelative} from "@welshman/lib"
  import {NOTE, COMMENT} from "@welshman/util"
  import {repository, loadRelayList} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import {MESSAGE_KINDS} from "@app/core/state"
  import {goToEvent} from "@app/util/routes"

  type Props = {
    pubkey: string
    url?: string
  }

  const {pubkey, url}: Props = $props()
  const filters: Filter[] = [{authors: [pubkey], limit: 1}]
  const events = deriveArray(deriveEventsById({repository, filters}))

  const viewEvent = () => goToEvent($events[0]!)

  onMount(async () => {
    // Make sure we have their relay selections before we load their posts
    await loadRelayList(pubkey)

    // Load at least one note, regardless of time frame
    load({
      filters: [{authors: [pubkey], limit: 1, kinds: [NOTE, COMMENT, ...MESSAGE_KINDS]}],
      relays: Router.get().FromPubkeys([pubkey]).getUrls(),
    })
  })
</script>

<div class="flex flex-wrap gap-2">
  {#if $events.length > 0}
    <Button onclick={viewEvent} class="badge badge-neutral">
      Last active {formatTimestampRelative($events[0].created_at)}
    </Button>
  {/if}
</div>
