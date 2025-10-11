/**
 * Flotilla Nostr I/O Adapter
 *
 * This adapter wraps the existing Flotilla/Welshman event layer to provide
 * the EventIO interface expected by @nostr-git components.
 *
 * It delegates to:
 * - `load` from @welshman/net for fetching events
 * - `publishThunk` from @welshman/app for publishing events
 * - `signer` from @welshman/app for signing events
 * - `Router` from @welshman/router for determining relay targets
 *
 * CRITICAL: This adapter does NOT create new pools or relay connections.
 * It uses the existing Flotilla infrastructure.
 */

import type {
  EventIO,
  NostrFilter,
  NostrEvent,
  PublishResult,
  SignEvent,
} from "@nostr-git/shared-types";
import { load } from "@welshman/net";
import { publishThunk, signer, pubkey as pubkeyStore } from "@welshman/app";
import { Router } from "@welshman/router";
import type { TrustedEvent, Filter } from "@welshman/util";
import { get } from "svelte/store";

/**
 * Convert NostrFilter (nostr-tools shape) to Welshman Filter.
 * Welshman Filter is mostly compatible but uses different type names.
 */
function convertFilter(filter: NostrFilter): Filter {
  // Welshman Filter is compatible with NostrFilter shape
  return filter as unknown as Filter;
}

/**
 * Convert Welshman TrustedEvent to NostrEvent.
 * These are structurally identical but have different type names.
 */
function convertEvent(event: TrustedEvent): NostrEvent {
  return event as unknown as NostrEvent;
}

/**
 * Creates an EventIO instance that delegates to Flotilla's existing
 * Welshman-based event layer.
 *
 * @returns EventIO implementation using Flotilla infrastructure
 */
export function createEventIO(): EventIO {
  return {
    /**
     * Fetch events from relays using Welshman's load function.
     * Uses the existing relay pool - does NOT create new connections.
     */
    fetchEvents: async (filters: NostrFilter[]): Promise<NostrEvent[]> => {
      // Determine relays from Router (user's configured relays)
      const relays = Router.get().FromUser().getUrls();

      console.log('[EventIO] fetchEvents:', {
        relays,
        filterCount: filters.length,
        filters: filters.map(f => ({ kinds: f.kinds, authors: f.authors, limit: f.limit })),
      });

      // Convert filters to Welshman format
      const welshmanFilters = filters.map(convertFilter);

      // Use existing Flotilla load function
      const events = await load({
        relays,
        filters: welshmanFilters,
      });

      console.log('[EventIO] fetchEvents result:', {
        eventCount: events.length,
        eventKinds: events.map(e => e.kind),
      });

      // Convert back to NostrEvent shape
      return events.map(convertEvent);
    },

    /**
     * Publish a signed event to relays using Welshman's publishThunk.
     * Uses the existing publish infrastructure - does NOT create new pools.
     */
    publishEvent: async (evt: NostrEvent): Promise<PublishResult> => {
      // Determine relays from Router
      const relays = Router.get().FromUser().getUrls();

      console.log('[EventIO] publishEvent:', {
        relays,
        event: {
          id: evt.id,
          kind: evt.kind,
          pubkey: evt.pubkey,
          created_at: evt.created_at,
          tagCount: evt.tags.length,
          tags: evt.tags,
          content: evt.content.substring(0, 100),
        },
      });

      // Convert event to TrustedEvent shape
      const event = evt as unknown as TrustedEvent;

      // Use existing Flotilla publish function
      const thunk = publishThunk({ event, relays });

      try {
        // Wait for publish to complete
        await thunk.result;

        console.log('[EventIO] publishEvent SUCCESS:', {
          eventId: evt.id,
          relays,
        });

        return {
          ok: true,
          relays,
        };
      } catch (error) {
        console.error('[EventIO] publishEvent FAILED:', {
          eventId: evt.id,
          relays,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          ok: false,
          error: error instanceof Error ? error.message : "Failed to publish event",
        };
      }
    },
  };
}

/**
 * Creates a SignEvent function that uses Flotilla's existing signer.
 *
 * CRITICAL: This uses the app's canonical signer from @welshman/app.
 * It does NOT create new signing logic.
 *
 * @returns SignEvent function that signs with Flotilla's signer
 */
export function createSignEvent(): SignEvent {
  return async (
    unsigned: Omit<NostrEvent, "id" | "pubkey" | "sig">
  ): Promise<NostrEvent> => {
    console.log('[SignEvent] Signing event:', {
      kind: unsigned.kind,
      created_at: unsigned.created_at,
      tagCount: unsigned.tags.length,
    });

    // Get the current signer from Welshman
    const $signer = signer.get();
    if (!$signer) {
      console.error('[SignEvent] No signer available');
      throw new Error("No signer available - user may not be logged in");
    }

    // Get current pubkey
    const $pubkey = get(pubkeyStore);
    if (!$pubkey) {
      console.error('[SignEvent] No pubkey available');
      throw new Error("No pubkey available - user may not be logged in");
    }

    // Create event template with pubkey
    const template = {
      ...unsigned,
      pubkey: $pubkey,
    } as any;

    console.log('[SignEvent] Signing with pubkey:', $pubkey);

    // Use Welshman's signer to sign the event
    const signed = await $signer.sign(template);

    console.log('[SignEvent] Event signed successfully:', {
      id: signed.id,
      pubkey: signed.pubkey,
    });

    // Return as NostrEvent
    return signed as unknown as NostrEvent;
  };
}

/**
 * Get the current user's pubkey from Flotilla's session.
 * Returns null if user is not logged in.
 */
export function getCurrentPubkey(): string | null {
  return get(pubkeyStore) ?? null;
}
