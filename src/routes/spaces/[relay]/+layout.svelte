<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {ago, MONTH} from "@welshman/lib"
  import {ROOM_META, EVENT_TIME, THREAD, COMMENT, MESSAGE, ROOMS} from "@welshman/util"
  import Page from "@lib/components/Page.svelte"
  import SecondaryNav from "@lib/components/SecondaryNav.svelte"
  import MenuSpace from "@app/components/MenuSpace.svelte"
  import SpaceAuthError from "@app/components/SpaceAuthError.svelte"
  import {pushToast} from "@app/util/toast"
  import {pushModal} from "@app/util/modal"
  import {setChecked} from "@app/util/notifications"
  import {checkRelayConnection, checkRelayAuth, checkRelayAccess} from "@app/core/commands"
  import {decodeRelay, userRoomsByUrl} from "@app/core/state"
  import {pullConservatively} from "@app/core/requests"
  import {notifications} from "@app/util/notifications"
  import {FREELANCE_JOB, GIT_REPO} from "@src/lib/util"

  interface Props {
    children?: import("svelte").Snippet
  }
  const {children}: Props = $props()

  const url = decodeRelay($page.params.relay)

  const rooms = Array.from($userRoomsByUrl.get(url) || [])

  const checkConnection = async () => {
    const connectionError = await checkRelayConnection(url)

    if (connectionError) {
      return pushToast({theme: "error", message: connectionError})
    }

    const [authError, accessError] = await Promise.all([checkRelayAuth(url), checkRelayAccess(url)])

    const error = authError || accessError

    if (error) {
      pushModal(SpaceAuthError, {url, error})
    }
  }

  // We have to watch this one, since on mobile the badge will be visible when active
  $effect(() => {
    if ($notifications.has($page.url.pathname)) {
      setChecked($page.url.pathname)
    }
  })

  onMount(() => {
    checkConnection()

    const relays = [url]
    const since = ago(MONTH)
    const controller = new AbortController()

    // Load group meta, threads, calendar events, comments, and recent messages
    // for user rooms to help with a quick page transition
    pullConservatively({
      relays,
      filters: [
        {kinds: [ROOMS]},
        {kinds: [ROOM_META]},
        {kinds: [GIT_REPO]},
        {kinds: [THREAD, EVENT_TIME], since},
        {kinds: [COMMENT], "#K": [String(THREAD), String(EVENT_TIME)], since},
        {kinds: [FREELANCE_JOB], "#s": ["0"]},
        {kinds: [COMMENT], "#K": [String(FREELANCE_JOB)]},
        ...rooms.map(room => ({kinds: [MESSAGE], "#h": [room], since})),
      ],
    })

    return () => {
      controller.abort()
    }
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
