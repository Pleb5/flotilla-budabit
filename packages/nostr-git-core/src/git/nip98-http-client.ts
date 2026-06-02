/**
 * NIP-98 HTTP Client Wrapper
 *
 * Wraps the isomorphic-git HTTP client to inject NIP-98 authentication
 * headers for GRASP relay URLs.
 */
import type {EventIO} from "../types/index.js"
import {isGraspRepoHttpUrl} from "../utils/grasp-url.js"

/**
 * Check if a URL is a GRASP relay URL that needs NIP-98 auth
 */
function isGraspUrl(url: string): boolean {
  return isGraspRepoHttpUrl(url)
}

/**
 * Build NIP-98 compatible Authorization header
 */
async function buildNip98AuthHeader(
  eventIO: EventIO,
  method: string,
  url: string,
): Promise<string | null> {
  try {
    // Check if signEvent is available
    if (!eventIO.signEvent) {
      console.warn("[NIP-98] EventIO.signEvent not available - auth not supported")
      return null
    }

    const pubkey = eventIO.getCurrentPubkey()
    if (!pubkey) {
      console.warn("[NIP-98] No pubkey available for auth")
      return null
    }

    // Create unsigned NIP-98 event
    const created_at = Math.floor(Date.now() / 1000)
    const unsignedEvent = {
      kind: 27235, // NIP-98 HTTP Auth
      created_at,
      tags: [
        ["u", url],
        ["method", method.toUpperCase()],
      ],
      content: "",
    }

    // Sign the event using EventIO.signEvent
    const signedEvent = await eventIO.signEvent(unsignedEvent)

    // Base64 encode the signed event for the Authorization header
    const b64 = btoa(JSON.stringify(signedEvent))
    return `Nostr ${b64}`
  } catch (error) {
    console.error("[NIP-98] Error building auth header:", error)
    return null
  }
}

/**
 * Create a NIP-98 aware HTTP client wrapper
 */
export function createNip98HttpClient(baseHttp: any, eventIO: EventIO | null): any {
  return {
    async request(request: any): Promise<any> {
      // If this is a GRASP URL and we have EventIO, try to add NIP-98 auth
      if (eventIO && isGraspUrl(request.url)) {
        const method = request.method || "GET"
        const authHeader = await buildNip98AuthHeader(eventIO, method, request.url)

        if (authHeader) {
          request.headers = {
            ...request.headers,
            Authorization: authHeader,
          }
          console.log("[NIP-98] Added auth header for GRASP URL:", request.url)
        }
      }

      // Delegate to base HTTP client
      return baseHttp.request(request)
    },
  }
}
