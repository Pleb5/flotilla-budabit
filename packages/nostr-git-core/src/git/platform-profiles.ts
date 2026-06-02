/**
 * Random Profile Generation for Platform Users
 *
 * Generates random Nostr profiles (kind 0 events) for platform users
 * encountered during repository imports. Each platform user gets a unique
 * random keypair per import session, even if the same user appears in
 * different imports.
 */

import type { NostrEvent } from 'nostr-tools';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';

/**
 * Default profile image URL for mirrored users
 * Used as fallback when platform avatar is not available
 */
export const DEFAULT_PROFILE_IMAGE_URL = '';

/**
 * Platform user profile information
 */
export interface PlatformUserProfile {
  /**
   * Private key (hex string) for signing events
   */
  privkey: string;

  /**
   * Public key (hex string) for the profile
   */
  pubkey: string;

  /**
   * Signed profile event (kind 0)
   */
  profileEvent: NostrEvent;

  /**
   * Original platform username
   */
  originalUsername: string;

  /**
   * Platform identifier (e.g., 'github', 'gitlab')
   */
  platform: string;
}

/**
 * Generate a random Nostr keypair
 *
 * @returns Object with private and public keys as hex strings
 */
export function generateRandomKeyPair(): { privkey: string; pubkey: string } {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);

  return {
    privkey: bytesToHex(secretKey),
    pubkey
  };
}

/**
 * Create a profile event (kind 0) for a platform user
 *
 * Creates a Nostr kind 0 event with:
 * - Name: "Original Name (mirrored user from <platform>)"
 * - Tags: ["imported", ""]
 * - Created at: import timestamp
 *
 * @param platform - Platform identifier (e.g., 'github', 'gitlab')
 * @param username - Original platform username
 * @param privkey - Private key (hex string) for signing the event
 * @returns Signed Nostr profile event
 */
export function createProfileEventForPlatformUser(
  platform: string,
  username: string,
  privkey: string
): NostrEvent {
  const displayName = username;
  const mirroredName = `${displayName} (mirrored user from ${platform})`;

  const profileContent = {
    name: mirroredName,
    picture: DEFAULT_PROFILE_IMAGE_URL
  };

  const eventTemplate: Omit<NostrEvent, 'id' | 'sig' | 'pubkey'> = {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['imported', '']],
    content: JSON.stringify(profileContent)
  };

  if (!/^[0-9a-fA-F]{64}$/.test(privkey)) {
    throw new Error(
      `Invalid private key format: expected 64 hex characters, got ${privkey.length}`
    );
  }
  const privkeyBytes = hexToBytes(privkey);

  const signedEvent = finalizeEvent(eventTemplate, privkeyBytes);

  return signedEvent;
}

/**
 * User profile map key format: "platform:username"
 *
 * @param platform - Platform identifier
 * @param username - Platform username
 * @returns Map key string
 */
export function getProfileMapKey(platform: string, username: string): string {
  return `${platform}:${username}`;
}

/**
 * Generate and store a profile for a platform user
 *
 * This function should be called for each unique platform user encountered
 * during import. It generates a new random keypair and creates a profile event.
 *
 * @param platform - Platform identifier (e.g., 'github', 'gitlab')
 * @param username - Platform username
 * @returns PlatformUserProfile with generated keys and signed profile event
 */
export function generatePlatformUserProfile(
  platform: string,
  username: string
): PlatformUserProfile {
  const { privkey, pubkey } = generateRandomKeyPair();

  const profileEvent = createProfileEventForPlatformUser(platform, username, privkey);

  return {
    privkey,
    pubkey,
    profileEvent,
    originalUsername: username,
    platform
  };
}
