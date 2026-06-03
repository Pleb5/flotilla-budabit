/**
 * Signer interface for NIP-04 encryption/decryption
 * This allows the parent application to provide signer functionality
 * without the UI package directly depending on @welshman
 */
export interface NostrSigner {
  /**
   * Encrypt a message using NIP-04
   */
  encrypt(recipientPubkey: string, message: string): Promise<string>;

  /**
   * Decrypt a message using NIP-04
   */
  decrypt(senderPubkey: string, encryptedMessage: string): Promise<string>;
}

/**
 * Signer context interface
 */
export interface SignerContext {
  signer: NostrSigner | null;
  pubkey: string | null;
  isReady: boolean;
}

/**
 * Default empty signer context
 */
export const defaultSignerContext: SignerContext = {
  signer: null,
  pubkey: null,
  isReady: false,
};
