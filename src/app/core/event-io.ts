/**
 * EventIO Implementation for Flotilla
 *
 * Bridges the @nostr-git/core EventIO interface with Flotilla's
 * existing Nostr infrastructure (welshman).
 */
import {load, publish} from "@welshman/net"
import {signer, pubkey} from "@welshman/app"
import type {EventIO, EventIORelayScope} from "@nostr-git/core/types"
import {sanitizeRelays} from "@nostr-git/core/utils"
import {get} from "svelte/store"

const EMPTY_RELAY_SCOPE_ERROR = "Repository EventIO requires at least one explicit relay"
const RELAYLESS_ANNOUNCEMENT_ERROR =
  "Repository announcements must declare at least one valid relay"

const requireRelays = (scope: EventIORelayScope): string[] => {
  const relays = sanitizeRelays(scope?.relays || [])
  if (relays.length === 0) throw new Error(EMPTY_RELAY_SCOPE_ERROR)
  return relays
}

const requireAnnouncementRelay = (event: any): void => {
  if (event?.kind !== 30617) return
  const declaredRelays = sanitizeRelays(
    (Array.isArray(event.tags) ? event.tags : [])
      .filter((tag: unknown): tag is string[] => Array.isArray(tag) && tag[0] === "relays")
      .flatMap((tag: string[]) => tag.slice(1)),
  )
  if (declaredRelays.length === 0) throw new Error(RELAYLESS_ANNOUNCEMENT_ERROR)
}

/**
 * Create an EventIO instance using Flotilla's Nostr infrastructure.
 *
 * This bridges the gap between @nostr-git/core's EventIO interface
 * and Flotilla's welshman-based Nostr implementation.
 */
export function createEventIO(): EventIO {
  return {
    async fetchEvents(filters: any[], scope: EventIORelayScope): Promise<any[]> {
      const relays = requireRelays(scope)
      const events: any[] = []

      await load({
        relays,
        filters,
        onEvent: (event: any) => {
          events.push(event)
        },
      })

      return events
    },

    async publishEvent(unsigned: any, scope: EventIORelayScope) {
      try {
        const relays = requireRelays(scope)
        requireAnnouncementRelay(unsigned)

        // Sign the event using Flotilla's signer
        const currentSigner = get(signer)
        if (!currentSigner) {
          return {
            ok: false,
            error: "No signer available",
          }
        }

        const signed = await currentSigner.sign(unsigned)

        await publish({
          event: signed,
          relays,
        })

        return {
          ok: true,
          relays,
        }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },

    async publishEvents(events: any[], scope: EventIORelayScope) {
      try {
        requireRelays(scope)
        events.forEach(requireAnnouncementRelay)
      } catch (error) {
        const failure = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
        return events.map(() => failure)
      }

      const results = []

      for (const unsigned of events) {
        const result = await this.publishEvent(unsigned, scope)
        results.push(result)
      }

      return results
    },

    getCurrentPubkey(): string | null {
      return get(pubkey) || null
    },

    async signEvent(unsigned: any) {
      const currentSigner = get(signer)
      if (!currentSigner) {
        throw new Error("No signer available")
      }
      return await currentSigner.sign(unsigned)
    },
  }
}
