/**
 * EventIO Implementation for Flotilla
 * 
 * Bridges the @nostr-git/core EventIO interface with Flotilla's
 * existing Nostr infrastructure (welshman).
 */
import { load, publish } from '@welshman/net';
import { signer, pubkey } from '@welshman/app';
import { Router } from '@welshman/router';
import type { EventIO } from '@nostr-git/core/types';
import { get } from 'svelte/store';

/**
 * Create a NIP-98 Authorization header for GRASP authentication.
 * This must be called on the main thread where the signer lives.
 */
export async function createNip98AuthHeader(url: string, method: string = 'POST'): Promise<string | null> {
  try {
    const currentSigner = get(signer);
    if (!currentSigner) {
      console.warn('[NIP-98] No signer available');
      return null;
    }

    const created_at = Math.floor(Date.now() / 1000);
    const unsignedEvent = {
      kind: 27235, // NIP-98 HTTP Auth
      created_at,
      tags: [
        ['u', url],
        ['method', method.toUpperCase()],
      ],
      content: '',
    };

    const signedEvent = await currentSigner.sign(unsignedEvent);
    const b64 = btoa(JSON.stringify(signedEvent));
    return `Nostr ${b64}`;
  } catch (error) {
    console.error('[NIP-98] Error creating auth header:', error);
    return null;
  }
}

/**
 * Create an EventIO instance using Flotilla's Nostr infrastructure.
 * 
 * This bridges the gap between @nostr-git/core's EventIO interface
 * and Flotilla's welshman-based Nostr implementation.
 */
export function createEventIO(): EventIO {
  return {
    async fetchEvents(filters: any[]): Promise<any[]> {
      const relays = Router.get().FromUser().getUrls();
      const events: any[] = [];
      
      await load({
        relays,
        filters,
        onEvent: (event: any) => {
          events.push(event);
        },
      });
      
      return events;
    },

    async publishEvent(unsigned: any) {
      try {
        // Sign the event using Flotilla's signer
        const currentSigner = get(signer);
        if (!currentSigner) {
          return {
            ok: false,
            error: 'No signer available',
          };
        }
        
        const signed = await currentSigner.sign(unsigned);
        
        // Publish to relays
        const relays = Router.get().FromUser().getUrls();
        await publish({
          event: signed,
          relays,
        });
        
        return {
          ok: true,
          relays,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async publishEvents(events: any[]) {
      const results = [];
      
      for (const unsigned of events) {
        const result = await this.publishEvent(unsigned);
        results.push(result);
      }
      
      return results;
    },

    getCurrentPubkey(): string | null {
      return get(pubkey) || null;
    },

    async signEvent(unsigned: any) {
      const currentSigner = get(signer);
      if (!currentSigner) {
        throw new Error('No signer available');
      }
      return await currentSigner.sign(unsigned);
    },
  };
}
