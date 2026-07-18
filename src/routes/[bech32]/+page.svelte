<script lang="ts">
  import {onMount} from "svelte"
  import * as nip19 from "nostr-tools/nip19"
  import type {MakeNonOptional} from "@welshman/lib"
  import type {TrustedEvent} from "@welshman/util"
  import {Address, getIdFilters} from "@welshman/util"
  import {load, LOCAL_RELAY_URL} from "@welshman/net"
  import {Router} from "@welshman/router"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import Spinner from "@lib/components/Spinner.svelte"
  import {goToEvent} from "@app/util/routes"
  import {INDEXER_RELAYS} from "@app/core/state"
  import {getRepoAnnouncementRelays} from "@app/core/git-state"
  import {refreshPubkeyOutboxRelays} from "@app/core/community-state"
  import {normalizeRelayHints} from "@app/util/event-links"

  const getAuthorRelays = (author?: string) => {
    if (!author) return []

    try {
      return Router.get().FromPubkey(author).getUrls() || []
    } catch {
      return []
    }
  }

  const getResolverRelays = (type: string, data: any, additionalRelays: string[] = []) => {
    const embeddedRelays = Array.isArray(data?.relays) ? data.relays : []
    const repoRelays =
      type === "naddr" && data?.kind === 30617 ? getRepoAnnouncementRelays(embeddedRelays) : []

    const relays = normalizeRelayHints(
      embeddedRelays,
      additionalRelays,
      getAuthorRelays(data?.author || data?.pubkey),
      repoRelays,
      INDEXER_RELAYS,
    )

    return [LOCAL_RELAY_URL, ...relays.filter(relay => relay !== LOCAL_RELAY_URL)]
  }

  const {bech32} = $page.params as MakeNonOptional<typeof $page.params>

  const fallbackPath = "/home"
  let destroyed = false
  let resolverController: AbortController | undefined

  const normalizePathname = (pathname: string) =>
    pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname

  const getCurrentBrowserPath = () =>
    `${window.location.pathname}${window.location.search}${window.location.hash}`

  const isCurrentResolverPath = () =>
    normalizePathname(window.location.pathname) === normalizePathname(`/${bech32}`)

  const attemptToNavigate = async () => {
    const {type, data} = nip19.decode(bech32) as any

    if (!["nevent", "naddr"].includes(type)) {
      return goto(fallbackPath, {replaceState: true})
    }

    const target = type === "nevent" ? data?.id : Address.fromNaddr(bech32).toString()
    if (!target) return goto(fallbackPath, {replaceState: true})

    let found = false
    const embeddedRelays = Array.isArray(data?.relays) ? data.relays : []
    const targetOutboxRelays =
      type === "naddr" && data?.kind === 30617 && embeddedRelays.length === 0
        ? await refreshPubkeyOutboxRelays(data.pubkey, getRepoAnnouncementRelays())
        : []
    if (destroyed) return

    const controller = new AbortController()
    resolverController = controller

    load({
      relays: getResolverRelays(type, data, targetOutboxRelays),
      filters: getIdFilters([target]),
      signal: controller.signal,
      onEvent: (event: TrustedEvent) => {
        if (destroyed) return
        found = true
        goToEvent(event, {replaceState: true})
      },
      onClose: () => {
        if (!destroyed && !found) {
          goto(fallbackPath, {replaceState: true})
        }
      },
    })
  }

  onMount(() => {
    destroyed = false
    void (async () => {
      if (!isCurrentResolverPath()) {
        await goto(getCurrentBrowserPath(), {replaceState: true})
        return
      }

      try {
        await attemptToNavigate()
      } catch (e) {
        if (!destroyed) await goto(fallbackPath, {replaceState: true})
      }
    })()

    return () => {
      destroyed = true
      resolverController?.abort()
    }
  })
</script>

<Spinner />
