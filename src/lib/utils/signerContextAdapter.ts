import {get} from "svelte/store"
import {signer, pubkey} from "@welshman/app"
import type {SignerContext, NostrSigner} from "@nostr-git/ui"

/**
 * Adapter that wraps @welshman signer to match NostrSigner interface
 */
class WelshmanSignerAdapter implements NostrSigner {
  private welshmanSigner: any

  constructor(welshmanSigner: any) {
    this.welshmanSigner = welshmanSigner
  }

  async encrypt(recipientPubkey: string, message: string): Promise<string> {
    return this.welshmanSigner.encrypt(recipientPubkey, message)
  }

  async decrypt(senderPubkey: string, encryptedMessage: string): Promise<string> {
    return this.welshmanSigner.decrypt(senderPubkey, encryptedMessage)
  }
}

/**
 * Create a signer context from @welshman stores
 */
export function createSignerContext(): SignerContext {
  const currentSigner = get(signer)
  const currentPubkey = get(pubkey)

  return {
    signer: currentSigner ? new WelshmanSignerAdapter(currentSigner) : null,
    pubkey: currentPubkey || null,
    isReady: !!(currentSigner && currentPubkey),
  }
}

/**
 * Create a reactive signer context that updates when @welshman stores change
 */
export function createReactiveSignerContext(): {
  getContext: () => SignerContext
  subscribe: (callback: (context: SignerContext) => void) => () => void
} {
  let currentContext = createSignerContext()
  const subscribers = new Set<(context: SignerContext) => void>()

  // Subscribe to @welshman store changes
  const unsubscribeSigner = signer.subscribe(() => {
    const newContext = createSignerContext()
    if (
      newContext.isReady !== currentContext.isReady ||
      newContext.pubkey !== currentContext.pubkey
    ) {
      currentContext = newContext
      subscribers.forEach(callback => callback(currentContext))
    }
  })

  const unsubscribePubkey = pubkey.subscribe(() => {
    const newContext = createSignerContext()
    if (
      newContext.isReady !== currentContext.isReady ||
      newContext.pubkey !== currentContext.pubkey
    ) {
      currentContext = newContext
      subscribers.forEach(callback => callback(currentContext))
    }
  })

  return {
    getContext: () => currentContext,
    subscribe: (callback: (context: SignerContext) => void) => {
      subscribers.add(callback)
      return () => {
        subscribers.delete(callback)
        if (subscribers.size === 0) {
          unsubscribeSigner()
          unsubscribePubkey()
        }
      }
    },
  }
}
