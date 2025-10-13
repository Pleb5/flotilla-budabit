<script lang="ts">
  import type {Snippet} from "svelte"
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {ago, sleep, MONTH} from "@welshman/lib"
  import {
    ROOM_META,
    EVENT_TIME,
    THREAD,
    COMMENT,
    MESSAGE,
    displayRelayUrl,
    ROOMS,
  } from "@welshman/util"
  import {SocketStatus} from "@welshman/net"
  import Page from "@lib/components/Page.svelte"
  import SecondaryNav from "@lib/components/SecondaryNav.svelte"
  import MenuSpace from "@app/components/MenuSpace.svelte"
  import {pushToast} from "@app/toast"
  import {setChecked} from "@app/notifications"
  import {decodeRelay, deriveSocket, userRoomsByUrl} from "@app/state"
  import {pullConservatively} from "@app/requests"
  import {notifications} from "@app/notifications"
  import {
    GIT_ISSUE,
    GIT_PATCH,
    GIT_REPO_ANNOUNCEMENT,
    GIT_REPO_STATE,
  } from "@nostr-git/shared-types"
  import {GRASP_SET_KIND} from "@nostr-git/shared-types"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()

  const url = decodeRelay($page.params.relay)

  const rooms = Array.from($userRoomsByUrl.get(url) || [])

  const socket = deriveSocket(url)

  // We have to watch this one, since on mobile the badge will be visible when active
  $effect(() => {
    if ($notifications.has($page.url.pathname)) {
      setChecked($page.url.pathname)
    }
  })

  onMount(() => {
    const since = ago(MONTH)

    sleep(2000).then(() => {
      if ($socket.status !== SocketStatus.Open) {
        pushToast({
          theme: "error",
          message: `Failed to connect to ${displayRelayUrl(url)}`,
        })
      }
    })

    // Load group meta, threads, calendar events, comments, and recent messages
    // for user rooms to help with a quick page transition
    pullConservatively({
      relays: [url],
      filters: [
        {kinds: [ROOMS]},
        {kinds: [GIT_REPO_ANNOUNCEMENT, GIT_REPO_STATE]},
        {kinds: [GIT_ISSUE, GIT_PATCH]},
        {kinds: [GRASP_SET_KIND]},
        {kinds: [ROOM_META]},
        {kinds: [THREAD, EVENT_TIME, MESSAGE], since},
        {kinds: [COMMENT], "#K": [String(THREAD), String(EVENT_TIME)], since},
        ...rooms.map(room => ({kinds: [MESSAGE], "#h": [room], since})),
      ],
    })
  })
</script>

<SecondaryNav>
  <MenuSpace {url} />
</SecondaryNav>
<Page>
  {#key $page.url.pathname}
    {@render children?.()}
  {/key}
</Page>
