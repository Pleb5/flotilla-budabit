<script lang="ts">
  import type {Snippet} from "svelte"
  import {page} from "$app/stores"
  import {once} from "@welshman/lib"
  import Page from "@lib/components/Page.svelte"
  import SecondaryNav from "@lib/components/SecondaryNav.svelte"
  import SpaceMenu from "@app/components/SpaceMenu.svelte"
  import SpaceAuthError from "@app/components/SpaceAuthError.svelte"
  import SpaceTrustRelay from "@app/components/SpaceTrustRelay.svelte"
  import {pushModal} from "@app/util/modal"
  import {setChecked} from "@app/util/notifications"
  import {decodeRelay, deriveRelayAuthError, relaysPendingTrust} from "@app/core/state"
  import {notifications} from "@app/util/notifications"
  import {GIT_ISSUE, GIT_PATCH, GIT_REPO_ANNOUNCEMENT, GIT_REPO_STATE, GRASP_SET_KIND} from "@nostr-git/shared-types"
  import { channelsByUrl, loadPlatformChannels } from "@src/lib/budabit"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()

  const url = decodeRelay($page.params.relay!)

  const rooms = Array.from($channelsByUrl.get(url)|| [])

  const socket = deriveSocket(url)

  const authError = deriveRelayAuthError(url)

  const showAuthError = once(() =>
    pushModal(SpaceAuthError, {url, error: $authError}, {noEscape: true}),
  )

  const showPendingTrust = once(() => pushModal(SpaceTrustRelay, {url}, {noEscape: true}))

  // We have to watch this one, since on mobile the badge will be visible when active
  $effect(() => {
    if ($notifications.has($page.url.pathname)) {
      setChecked($page.url.pathname)
    }
  })

  // Watch for relay errors and notify the user
  $effect(() => {
    if ($authError) {
      showAuthError()
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
    loadPlatformChannels()

    pullConservatively({
      relays: [url],
      filters: [
        {kinds: [GIT_REPO_ANNOUNCEMENT, GIT_REPO_STATE]},
        {kinds: [GIT_ISSUE, GIT_PATCH]},
        {kinds: [GRASP_SET_KIND]},
        {kinds: [THREAD, EVENT_TIME, MESSAGE], since},
        {kinds: [COMMENT], "#K": [String(THREAD), String(EVENT_TIME)], since},
        ...rooms.map(room => ({kinds: [MESSAGE], "#h": [room.id], since})),
      ],
    })
  })
</script>

<SecondaryNav>
  <SpaceMenu {url} />
</SecondaryNav>
<Page>
  {#key $page.url.pathname}
    {@render children?.()}
  {/key}
</Page>
