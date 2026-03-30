import { get } from 'svelte/store';
import { signer, pubkey } from '@welshman/app';
import type { SignerContext, NostrSigner } from '@nostr-git/ui';

/**
 * Adapter that wraps @welshman signer to match NostrSigner interface.
 * Handles both direct encrypt/decrypt and nip44-namespaced methods.
 */
class WelshmanSignerAdapter implements NostrSigner {
  private welshmanSigner: any;

  constructor(welshmanSigner: any) {
    this.welshmanSigner = welshmanSigner;
  }

  async encrypt(recipientPubkey: string, message: string): Promise<string> {
    if (this.welshmanSigner.nip44?.encrypt) {
      return this.welshmanSigner.nip44.encrypt(recipientPubkey, message)
    }
    if (typeof this.welshmanSigner.encrypt === 'function') {
      return this.welshmanSigner.encrypt(recipientPubkey, message)
    }
    throw new Error('Signer does not support encrypt')
  }

  async decrypt(senderPubkey: string, encryptedMessage: string): Promise<string> {
    if (this.welshmanSigner.nip44?.decrypt) {
      return this.welshmanSigner.nip44.decrypt(senderPubkey, encryptedMessage)
    }
    if (typeof this.welshmanSigner.decrypt === 'function') {
      return this.welshmanSigner.decrypt(senderPubkey, encryptedMessage)
    }
    throw new Error('Signer does not support decrypt')
  }
}

/**
 * Create a signer context from @welshman stores
 */
export function createSignerContext(): SignerContext {
  const currentSigner = get(signer);
  const currentPubkey = get(pubkey);

  return {
    signer: currentSigner ? new WelshmanSignerAdapter(currentSigner) : null,
    pubkey: currentPubkey || null,
    isReady: !!(currentSigner && currentPubkey),
  };
}

/**
 * Create a reactive signer context that updates when @welshman stores change
 */
export function createReactiveSignerContext(): { 
  getContext: () => SignerContext;
  subscribe: (callback: (context: SignerContext) => void) => () => void;
} {
  let currentContext = createSignerContext()
  const subscribers = new Set<(context: SignerContext) => void>()
  let unsubscribeSigner: (() => void) | null = null
  let unsubscribePubkey: (() => void) | null = null

  const notifySubscribers = () => {
    const newContext = createSignerContext()
    if (newContext.isReady !== currentContext.isReady || 
        newContext.pubkey !== currentContext.pubkey) {
      currentContext = newContext
      subscribers.forEach(callback => callback(currentContext))
    }
  }

  const startListening = () => {
    if (unsubscribeSigner) return
    unsubscribeSigner = signer.subscribe(notifySubscribers)
    unsubscribePubkey = pubkey.subscribe(notifySubscribers)
  }

  const stopListening = () => {
    unsubscribeSigner?.()
    unsubscribePubkey?.()
    unsubscribeSigner = null
    unsubscribePubkey = null
  }

  return {
    getContext: () => currentContext,
    subscribe: (callback: (context: SignerContext) => void) => {
      if (subscribers.size === 0) startListening()
      subscribers.add(callback)
      return () => {
        subscribers.delete(callback)
        if (subscribers.size === 0) stopListening()
      }
    }
  }
}
