/**
 * Crypto polyfill for environments where crypto.subtle is not available
 * Uses the existing SHA-256 implementation from @nostr-git/ui
 */

import { sha256 } from '@nostr-git/ui';

// Convert hex string to Uint8Array
function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

// Convert ArrayBuffer to string for SHA-256 input
function arrayBufferToString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

// Create a polyfill for crypto.subtle.digest
function createDigestPolyfill() {
  return async (algorithm: string, data: ArrayBuffer | Uint8Array): Promise<ArrayBuffer> => {
    if (algorithm.toLowerCase() !== 'sha-256') {
      throw new Error(`Unsupported algorithm: ${algorithm}`);
    }

    // Convert to ArrayBuffer safely
    let inputData: ArrayBuffer;
    if (data instanceof ArrayBuffer) {
      inputData = data;
    } else {
      // Create a new ArrayBuffer from the Uint8Array data
      inputData = new ArrayBuffer(data.length);
      new Uint8Array(inputData).set(data);
    }
    
    const inputString = arrayBufferToString(inputData);
    const hashHex = sha256(inputString);
    const hashBytes = hexToUint8Array(hashHex);
    
    // Create a new ArrayBuffer from the hash bytes
    const result = new ArrayBuffer(hashBytes.length);
    new Uint8Array(result).set(hashBytes);
    return result;
  };
}

// Initialize crypto polyfill if needed
export function initializeCryptoPolyfill() {
  if (typeof window !== 'undefined' && window.crypto && !window.crypto.subtle) {
    console.warn('crypto.subtle not available, using polyfill');
    
    // Create a polyfill for crypto.subtle
    const polyfillSubtle = {
      digest: createDigestPolyfill(),
      // Add other methods as needed
    };

    // Assign the polyfill
    (window.crypto as any).subtle = polyfillSubtle;
  }
}

// Auto-initialize when this module is imported
if (typeof window !== 'undefined') {
  initializeCryptoPolyfill();
}
