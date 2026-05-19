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
  import {normalizeRelayHints} from "@app/util/event-links"

  const getAuthorRelays = (author?: string) => {
    if (!author) return []

    try {
      return Router.get().FromPubkey(author).getUrls() || []
    } catch {
      return []
    }
  }

  const getResolverRelays = (type: string, data: any) => {
    const embeddedRelays = Array.isArray(data?.relays) ? data.relays : []
    const repoRelays = type === "naddr" && data?.kind === 30617 ? getRepoAnnouncementRelays(embeddedRelays) : []

    const relays = normalizeRelayHints(
      embeddedRelays,
      getAuthorRelays(data?.author || data?.pubkey),
      repoRelays,
      INDEXER_RELAYS,
    )

    return [LOCAL_RELAY_URL, ...relays.filter(relay => relay !== LOCAL_RELAY_URL)]
  }

  const {bech32} = $page.params as MakeNonOptional<typeof $page.params>

  const attemptToNavigate = async () => {
    const {type, data} = nip19.decode(bech32) as any

    if (!["nevent", "naddr"].includes(type)) {
      return goto("/", {replaceState: true})
    }

    const target = type === "nevent" ? data?.id : Address.fromNaddr(bech32).toString()
    if (!target) return goto("/", {replaceState: true})

    let found = false

    load({
      relays: getResolverRelays(type, data),
      filters: getIdFilters([target]),
      onEvent: (event: TrustedEvent) => {
        found = true
        goToEvent(event, {replaceState: true})
      },
      onClose: () => {
        if (!found) {
          goto("/", {replaceState: true})
        }
      },
    })
  }

  onMount(async () => {
    try {
      await attemptToNavigate()
    } catch (e) {
      goto("/", {replaceState: true})
    }
  })
</script>

<Spinner />
