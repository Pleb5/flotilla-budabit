import {derived} from "svelte/store"
import {repository} from "@welshman/app"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {LRUCache} from "@welshman/lib"
import {loadCommunityEventsWithStatus} from "@app/core/community-state"
import {getBudabitProfileRelays} from "@app/core/profile-resolver"
import {getPubkeyOutboxRelays} from "@app/core/community-relays"
import {IDENTITY_KIND, selectIdentityEvent} from "@app/util/profile-identity"

const loads = new Map<string, Promise<void>>()
const loadedAt = new LRUCache<string, number>(500)

export const loadProfileIdentities = (pubkey: string, relays: string[] = [], force = false) => {
  const urls = getBudabitProfileRelays({relays: [...relays, ...getPubkeyOutboxRelays(pubkey)]})
  const key = `${pubkey}:${urls.join(",")}`
  if (loads.has(key)) return loads.get(key)!
  if (!force && Date.now() - (loadedAt.get(key) || 0) < 60000) return Promise.resolve()
  const promise = loadCommunityEventsWithStatus(
    urls,
    [{kinds: [IDENTITY_KIND], authors: [pubkey], limit: 1}],
    {timeout: 5000},
  )
    .then(result => {
      if (
        !result.events.length &&
        !result.complete &&
        !Object.values(result.outcomes || {}).includes("complete")
      ) {
        throw new Error("Identity relays could not be reached. Retry loading your profile.")
      }
      loadedAt.set(key, Date.now())
    })
    .finally(() => {
      loads.delete(key)
    })
  loads.set(key, promise)
  return promise
}

export const deriveProfileIdentities = (pubkey: string) =>
  derived(
    deriveEventsAsc(
      deriveEventsById({repository, filters: [{kinds: [IDENTITY_KIND], authors: [pubkey]}]}),
    ),
    events => selectIdentityEvent(events, pubkey),
  )
