import {makeLoader, type LoadOptions} from "@welshman/net"
import {matchFilters, type Filter, type TrustedEvent} from "@welshman/util"
import {verifyEvent} from "nostr-tools/pure"

const TIMEOUT_MS = 5_000
const publicRelay = (relay: string) => relay.split("?", 1)[0].split("#", 1)[0]

/** Loader promises may resolve on timeout/threshold, not just EOSE. Observe each relay separately. */
export async function queryExtensionRelays(relays: string[], filter: Filter) {
  const results = await Promise.all(
    relays.map(async relay => {
      // The shared load singleton batches even separate bridge requests and deduplicates
      // across relays. Each page needs its own tracker AND filter union/batch state.
      const load = makeLoader({delay: 0})
      const controller = new AbortController()
      const events = new Map<string, TrustedEvent>()
      let active = true,
        eose = false,
        failed = false,
        overflow = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<void>(resolve => {
        timer = setTimeout(() => {
          controller.abort()
          resolve()
        }, TIMEOUT_MS)
      })
      const options: LoadOptions = {
        relays: [relay],
        filters: [filter],
        signal: controller.signal,
        onEvent(event) {
          if (!active || !matchFilters([filter], event)) return
          try {
            // Do not inherit cached verification flags from user-configured trusted relays.
            if (
              !verifyEvent({
                id: event.id,
                pubkey: event.pubkey,
                sig: event.sig,
                kind: event.kind,
                tags: event.tags,
                content: event.content,
                created_at: event.created_at,
              })
            )
              return
          } catch {
            return
          }
          if (events.size >= (filter.limit ?? 500) && !events.has(event.id)) {
            overflow = true
            return
          }
          events.set(event.id, event)
        },
        onEose: () => {
          if (active) eose = true
        },
        onClosed: () => {
          if (active) failed = true
        },
        onDisconnect: () => {
          if (active && !eose) failed = true
        },
      }
      try {
        await Promise.race([Promise.resolve().then(() => load(options)), timeout])
      } catch {
        failed = true
      } finally {
        active = false
        clearTimeout(timer)
        controller.abort()
      }
      const allIds =
        Array.isArray(filter.ids) &&
        filter.ids.length > 0 &&
        filter.ids.every(id => /^[0-9a-f]{64}$/.test(id) && events.has(id))
      return {
        relay: publicRelay(relay),
        events: [...events.values()],
        complete: !overflow && (eose || allIds),
        failed,
      }
    }),
  )
  return {
    status: "ok",
    events: [
      ...new Map(results.flatMap(result => result.events).map(event => [event.id, event])).values(),
    ],
    complete: results.every(result => result.complete),
    completedRelays: results.filter(result => result.complete).map(result => result.relay),
    failedRelays: results
      .filter(result => !result.complete && result.failed)
      .map(result => result.relay),
    timedOutRelays: results
      .filter(result => !result.complete && !result.failed)
      .map(result => result.relay),
  }
}
