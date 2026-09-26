import type {RepoCommunityBinding} from "@nostr-git/core/events"
import {untrack} from "svelte"
import {repository} from "@welshman/app"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {DELETE, type Filter, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  makeCommunityPointer,
  normalizeRelays,
  parseCommunityDefinitionAddress,
  selectCurrentCommunityDefinitions,
} from "@app/core/community"
import {
  COMMUNITY_DISCOVERY_RELAYS,
  hydratePubkeyOutboxRelays,
  loadCommunityEvents,
  resolveExactCommunityDefinition,
} from "@app/core/community-state"
import {selectRepoCommunityDefinition} from "./repo-community-metadata"

export const REPO_COMMUNITY_METADATA_KEY = "repo-community-metadata"
export type RepoCommunityMetadata = ReturnType<typeof createRepoCommunityMetadata>
const DISCOVERY_LIMIT = 20

/** Shared display metadata for repository cards, sessions, overview and settings. */
export const createRepoCommunityMetadata = (getBinding: () => RepoCommunityBinding | undefined) => {
  const binding = $derived(getBinding())
  const scopeKey = $derived(
    binding ? JSON.stringify([binding.communityId, binding.address, binding.relay]) : "",
  )
  let definitionEvents = $state.raw<TrustedEvent[]>([])
  let deleteEvents = $state.raw<TrustedEvent[]>([])
  let saturated = $state(false)

  $effect(() => {
    const scope = scopeKey ? untrack(() => binding) : undefined
    definitionEvents = []
    saturated = false
    if (!scope) return

    const exact = scope.address ? parseCommunityDefinitionAddress(scope.address) : undefined
    const filter: Filter = {
      kinds: [COMMUNITY_DEFINITION_KIND],
      "#d": [scope.communityId],
      ...(exact ? {authors: [exact.ownerPubkey]} : {}),
    }
    const unsubscribe = deriveEventsAsc(
      deriveEventsById({repository, filters: [filter]}),
    ).subscribe(events => {
      definitionEvents = events
    })
    const controller = new AbortController()
    const loadEvents = (relays: string[], filters: Filter[]) =>
      loadCommunityEvents(relays, filters, {timeout: 3000, signal: controller.signal})
    const relays = normalizeRelays([scope.relay || "", ...COMMUNITY_DISCOVERY_RELAYS])

    void (async () => {
      if (exact) {
        await resolveExactCommunityDefinition(
          makeCommunityPointer({...exact, relayHints: [scope.relay || ""]})!,
          {
            discoveryRelays: COMMUNITY_DISCOVERY_RELAYS,
            hydrateOwnerOutbox: hydratePubkeyOutboxRelays,
            loadEvents,
          },
        )
      } else if (relays.length) {
        const events = await loadEvents(relays, [{...filter, limit: DISCOVERY_LIMIT}])
        if (controller.signal.aborted) return
        saturated = events.length >= DISCOVERY_LIMIT
        const authors = [
          ...new Set(
            [...selectCurrentCommunityDefinitions(events).values()].map(item => item.ownerPubkey),
          ),
        ]
        if (authors.length) await loadEvents(relays, [{kinds: [DELETE], authors}])
      }
    })().catch(() => undefined)

    return () => {
      controller.abort()
      unsubscribe()
    }
  })

  const authorsKey = $derived(
    [...new Set(definitionEvents.map(event => event.pubkey))].sort().join(","),
  )
  $effect(() => {
    deleteEvents = []
    if (!authorsKey) return
    return deriveEventsAsc(
      deriveEventsById({repository, filters: [{kinds: [DELETE], authors: authorsKey.split(",")}]}),
    ).subscribe(events => {
      deleteEvents = events
    })
  })

  const definition = $derived(
    saturated
      ? undefined
      : selectRepoCommunityDefinition(binding, [...definitionEvents, ...deleteEvents]),
  )
  const pointer = $derived.by(() => {
    const branch = binding?.address
      ? parseCommunityDefinitionAddress(binding.address)
      : definition?.pointer
    return branch
      ? makeCommunityPointer({
          ...branch,
          relayHints: [binding?.relay || "", ...(definition?.relays || [])],
        })
      : undefined
  })

  return {
    get binding() {
      return binding
    },
    get definition() {
      return definition
    },
    get pointer() {
      return pointer
    },
    get label() {
      return definition?.metadata.name || (binding ? `${binding.communityId.slice(0, 8)}...` : "")
    },
    get relays() {
      return normalizeRelays([binding?.relay || "", ...(definition?.relays || [])])
    },
  }
}
