/**
 * EventIO Implementation for Flotilla
 *
 * Bridges the @nostr-git/core EventIO interface with Flotilla's
 * existing Nostr infrastructure (welshman).
 */
import {load, publish, PublishStatus} from "@welshman/net"
import {signer, pubkey} from "@welshman/app"
import type {
  EventIO,
  EventIORelayScope,
  PublishRelayOutcome,
  PublishResult,
} from "@nostr-git/core/types"
import {sanitizeRelays} from "@nostr-git/core/utils"
import {get} from "svelte/store"

const EMPTY_RELAY_SCOPE_ERROR = "Repository EventIO requires at least one explicit relay"
const RELAYLESS_ANNOUNCEMENT_ERROR =
  "Repository announcements must declare at least one valid relay"
const ANNOUNCEMENT_SCOPE_ERROR =
  "Repository announcement relays must be included in the publication scope"
const MALFORMED_PUBLISH_OUTCOMES_ERROR = "Publisher returned malformed relay outcomes"
const NO_RELAY_ACCEPTED_ERROR = "Event was not accepted by any relay"
const NO_DECLARED_RELAY_ACCEPTED_ERROR =
  "Repository announcement was not accepted by any declared relay"
const SIGNED_EVENT_MUTATION_ERROR = "Signer changed event policy fields"

const requireRelays = (scope: EventIORelayScope): string[] => {
  const relays = sanitizeRelays(scope?.relays || [])
  if (relays.length === 0) throw new Error(EMPTY_RELAY_SCOPE_ERROR)
  return relays
}

const requireAnnouncementRelays = (event: any, relays: string[]): string[] => {
  if (event?.kind !== 30617) return []
  const declaredRelays = sanitizeRelays(
    (Array.isArray(event.tags) ? event.tags : [])
      .filter((tag: unknown): tag is string[] => Array.isArray(tag) && tag[0] === "relays")
      .flatMap((tag: string[]) => tag.slice(1)),
  )
  if (declaredRelays.length === 0) throw new Error(RELAYLESS_ANNOUNCEMENT_ERROR)
  if (declaredRelays.some(relay => !relays.includes(relay))) {
    throw new Error(ANNOUNCEMENT_SCOPE_ERROR)
  }
  return declaredRelays
}

const isPublishStatus = (status: unknown): status is PublishRelayOutcome["status"] => {
  return (
    status === PublishStatus.Success ||
    status === PublishStatus.Failure ||
    status === PublishStatus.Timeout ||
    status === PublishStatus.Aborted
  )
}

const requireUnchangedSignedPayload = (unsigned: any, signed: any): void => {
  if (
    signed?.kind !== unsigned?.kind ||
    signed?.created_at !== unsigned?.created_at ||
    signed?.content !== unsigned?.content ||
    JSON.stringify(signed?.tags) !== JSON.stringify(unsigned?.tags)
  ) {
    throw new Error(SIGNED_EVENT_MUTATION_ERROR)
  }
}

const failedPublishOutcomes = (
  relays: string[],
  detail: string,
): Record<string, PublishRelayOutcome> =>
  Object.fromEntries(
    relays.map(relay => [relay, {relay, status: PublishStatus.Failure, detail}]),
  )

const parsePublishOutcomes = (
  value: unknown,
  relays: string[],
): Record<string, PublishRelayOutcome> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null

  const entries = Object.entries(value)
  const expectedRelays = new Set(relays)
  if (entries.length !== expectedRelays.size) return null

  const outcomes: Array<[string, PublishRelayOutcome]> = []
  for (const [relay, outcome] of entries) {
    if (
      !expectedRelays.has(relay) ||
      !outcome ||
      typeof outcome !== "object" ||
      Array.isArray(outcome)
    ) {
      return null
    }

    const {status, detail, relay: outcomeRelay} = outcome as Record<string, unknown>
    if (!isPublishStatus(status) || typeof detail !== "string" || outcomeRelay !== relay) {
      return null
    }
    outcomes.push([relay, {relay, status, detail}])
  }

  return Object.fromEntries(outcomes)
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
      let eventId: string | undefined
      try {
        const relays = requireRelays(scope)
        requireAnnouncementRelays(unsigned, relays)

        // Sign the event using Flotilla's signer
        const currentSigner = get(signer)
        if (!currentSigner) {
          return {
            ok: false,
            error: "No signer available",
          }
        }

        const signed = await currentSigner.sign(unsigned)
        eventId = signed.id
        requireUnchangedSignedPayload(unsigned, signed)
        const signedDeclaredRelays = requireAnnouncementRelays(signed, relays)

        const primaryRelays = signed?.kind === 30617 ? signedDeclaredRelays : relays
        const primaryOutcomes = parsePublishOutcomes(
          await publish({event: signed, relays: primaryRelays}),
          primaryRelays,
        )
        if (!primaryOutcomes) {
          return {
            ok: false,
            eventId,
            error: MALFORMED_PUBLISH_OUTCOMES_ERROR,
          }
        }

        const primaryAcceptedRelays = primaryRelays.filter(
          relay => primaryOutcomes[relay].status === PublishStatus.Success,
        )
        if (primaryAcceptedRelays.length === 0) {
          return {
            ok: false,
            eventId,
            relays: [],
            outcomes: primaryOutcomes,
            error:
              signed?.kind === 30617
                ? NO_DECLARED_RELAY_ACCEPTED_ERROR
                : NO_RELAY_ACCEPTED_ERROR,
          }
        }

        let outcomes = primaryOutcomes
        let acceptedRelays = primaryAcceptedRelays
        const discoveryRelays = relays.filter(relay => !signedDeclaredRelays.includes(relay))
        if (signed?.kind === 30617 && discoveryRelays.length > 0) {
          try {
            const discoveryOutcomes = parsePublishOutcomes(
              await publish({event: signed, relays: discoveryRelays}),
              discoveryRelays,
            )
            outcomes = {
              ...outcomes,
              ...(discoveryOutcomes ||
                failedPublishOutcomes(discoveryRelays, MALFORMED_PUBLISH_OUTCOMES_ERROR)),
            }
            if (discoveryOutcomes) {
              acceptedRelays = [
                ...acceptedRelays,
                ...discoveryRelays.filter(
                  relay => discoveryOutcomes[relay].status === PublishStatus.Success,
                ),
              ]
            }
          } catch (error) {
            outcomes = {
              ...outcomes,
              ...failedPublishOutcomes(
                discoveryRelays,
                error instanceof Error ? error.message : String(error),
              ),
            }
          }
        }

        return {
          ok: true,
          eventId,
          relays: acceptedRelays,
          outcomes,
        }
      } catch (error) {
        return {
          ok: false,
          ...(eventId ? {eventId} : {}),
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },

    async publishEvents(events: any[], scope: EventIORelayScope) {
      try {
        const relays = requireRelays(scope)
        events.forEach(event => requireAnnouncementRelays(event, relays))
      } catch (error) {
        const failure = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
        return events.map(() => failure)
      }

      const results: PublishResult[] = []

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
