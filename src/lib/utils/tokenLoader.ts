import { get } from 'svelte/store';
import { signer, pubkey } from '@welshman/app';

export interface TokenEntry {
  host: string;
  token: string;
}

/**
 * Wait for signer and pubkey to be available
 * This is crucial for NIP-04 decryption to work
 */
async function waitForSignerReady(maxWaitMs: number = 10000): Promise<{ signer: any; pubkey: string } | null> {
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const checkSigner = () => {
      const currentSigner = get(signer);
      const currentPubkey = get(pubkey);
      
      if (currentSigner && currentPubkey) {

        resolve({ signer: currentSigner, pubkey: currentPubkey });
        return;
      }
      
      // Check if we've exceeded max wait time
      if (Date.now() - startTime > maxWaitMs) {
        console.warn('🔐 Timeout waiting for signer/pubkey to be ready');
        resolve(null);
        return;
      }
      
      // Try again in 100ms
      setTimeout(checkSigner, 100);
    };
    
    checkSigner();
  });
}

/**
 * Load tokens from localStorage with NIP-04 decryption
 * This function waits for signer to be ready before attempting decryption
 */
export async function loadTokensFromStorage(tokenKey: string): Promise<TokenEntry[]> {
  try {
    // Check if we're in browser environment
    if (typeof localStorage === 'undefined') {
      return [];
    }

    const encryptedTokens = localStorage.getItem(tokenKey);
    if (!encryptedTokens) {
      return [];
    }


    
    // Wait for signer and pubkey to be available
    const signerInfo = await waitForSignerReady();
    if (!signerInfo) {
      console.warn('🔐 Cannot load tokens: signer or pubkey not available after waiting');
      return [];
    }


    
    // Decrypt the tokens with timeout to prevent hanging
    const decryptPromise = signerInfo.signer.nip04.decrypt(signerInfo.pubkey, encryptedTokens);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('NIP-04 decryption timed out after 10 seconds')), 10000)
    );
    
    const decrypted = await Promise.race([decryptPromise, timeoutPromise]);
    
    if (!decrypted) {
      console.warn('🔐 Failed to decrypt tokens from localStorage');
      return [];
    }

    const tokens = JSON.parse(decrypted) as TokenEntry[];
    return tokens;

  } catch (error) {
    console.error('🔐 Failed to load tokens from localStorage:', error);
    return [];
  }
}

/**
 * Save tokens to localStorage with NIP-04 encryption
 */
export async function saveTokensToStorage(tokenKey: string, tokens: TokenEntry[]): Promise<void> {
  try {
    // Check if we're in browser environment
    if (typeof localStorage === 'undefined') {
      throw new Error('localStorage not available');
    }

    // Get current signer and pubkey
    const currentSigner = get(signer);
    const currentPubkey = get(pubkey);

    if (!currentSigner || !currentPubkey) {
      throw new Error('Signer or pubkey not available');
    }

    // Encrypt the tokens
    const encrypted = await currentSigner.nip04.encrypt(currentPubkey, JSON.stringify(tokens));
    localStorage.setItem(tokenKey, encrypted);
    


  } catch (error) {
    console.error('Failed to save tokens to localStorage:', error);
    throw error;
  }
}
