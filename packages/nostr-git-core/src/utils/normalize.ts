/**
 * Repository Key Normalization
 *
 * This module provides utilities to normalize various repository identifier formats
 * into a canonical internal representation (naddr).
 *
 * Supported input formats:
 * - naddr (already canonical)
 * - nip-05/name (resolve nip-05 to pubkey, then encode as naddr)
 * - npub/name (decode npub to pubkey, then encode as naddr)
 * - pubkey/name (hex pubkey, encode as naddr)
 *
 * All internal operations (FS keys, cache keys, routing) MUST use the normalized naddr.
 */

import { nip19, nip05 } from 'nostr-tools';

/**
 * Input can be:
 * - An naddr string (naddr1...)
 * - A slash-separated identifier (nip-05/name, npub/name, pubkey/name)
 * - Any other string format
 */
export type RepoKeyInput =
  | `${string}/${string}` // Slash-separated formats
  | string;               // naddr or other addressable forms

/**
 * Normalized repository key with parsed components.
 */
export interface NormalizedRepoKey {
  /** Original input string */
  input: string;
  /** Canonical naddr representation (internal key) */
  naddr: string;
  /** Parsed components */
  parts: {
    /** NIP-05 identifier if input was nip-05/name */
    nip05?: string;
    /** npub if input was npub/name or derived from pubkey */
    npub?: string;
    /** Hex pubkey (always present after normalization) */
    pubkey: string;
    /** Repository name/identifier */
    name?: string;
  };
}

/**
 * Normalize a repository key input to canonical naddr format.
 *
 * This function accepts various input formats and normalizes them to a consistent
 * internal representation (naddr). All FS/cache/routing operations should use the
 * normalized naddr.
 *
 * @param input - Repository identifier in any supported format
 * @returns Normalized repository key with canonical naddr
 * @throws Error if input cannot be resolved or is invalid
 *
 * @example
 * // naddr input (already canonical)
 * const key1 = await normalizeRepoKey('naddr1...');
 *
 * // npub/name format
 * const key2 = await normalizeRepoKey('npub1.../my-repo');
 *
 * // hex pubkey/name format
 * const key3 = await normalizeRepoKey('abc123.../my-repo');
 *
 * // nip-05/name format (requires network lookup)
 * const key4 = await normalizeRepoKey('user@domain.com/my-repo');
 */
export async function normalizeRepoKey(input: RepoKeyInput): Promise<NormalizedRepoKey> {
  if (!input || typeof input !== 'string') {
    throw new Error('Invalid input: must be a non-empty string');
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Invalid input: empty string after trimming');
  }

  // Case 1: Input is already an naddr
  if (trimmed.startsWith('naddr1')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type !== 'naddr') {
        throw new Error(`Expected naddr but got ${decoded.type}`);
      }

      const data = decoded.data as nip19.AddressPointer;
      
      // Validate it's a repo announcement (kind 30617)
      if (data.kind !== 30617) {
        throw new Error(`Invalid kind ${data.kind}, expected 30617 (repo announcement)`);
      }

      return {
        input: trimmed,
        naddr: trimmed,
        parts: {
          pubkey: data.pubkey,
          npub: nip19.npubEncode(data.pubkey),
          name: data.identifier || undefined,
        },
      };
    } catch (error) {
      throw new Error(`Failed to decode naddr: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Case 2: Input contains a slash (nip-05/name, npub/name, pubkey/name)
  if (trimmed.includes('/')) {
    const [identifierPart, namePart] = trimmed.split('/');
    
    if (!identifierPart || !namePart) {
      throw new Error('Invalid format: slash-separated input must have both identifier and name');
    }

    let pubkey: string;
    let nip05Identifier: string | undefined;

    // Case 2a: npub/name
    if (identifierPart.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(identifierPart);
        if (decoded.type !== 'npub') {
          throw new Error(`Expected npub but got ${decoded.type}`);
        }
        pubkey = decoded.data as string;
      } catch (error) {
        throw new Error(`Failed to decode npub: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Case 2b: nip-05/name (contains @ symbol)
    else if (identifierPart.includes('@')) {
      nip05Identifier = identifierPart;
      try {
        const resolved = await nip05.queryProfile(identifierPart);
        if (!resolved || !resolved.pubkey) {
          throw new Error(`Failed to resolve NIP-05 identifier: ${identifierPart}`);
        }
        pubkey = resolved.pubkey;
      } catch (error) {
        throw new Error(`Failed to resolve NIP-05 ${identifierPart}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Case 2c: hex pubkey/name
    else {
      // Validate hex pubkey (64 hex characters)
      if (!/^[0-9a-f]{64}$/i.test(identifierPart)) {
        throw new Error(`Invalid pubkey format: must be 64 hex characters, got ${identifierPart.length} characters`);
      }
      pubkey = identifierPart.toLowerCase();
    }

    // Build naddr from pubkey and name
    const naddr = nip19.naddrEncode({
      kind: 30617,
      pubkey,
      identifier: namePart,
      relays: [], // Relays will be resolved at runtime
    });

    return {
      input: trimmed,
      naddr,
      parts: {
        pubkey,
        npub: nip19.npubEncode(pubkey),
        name: namePart,
        nip05: nip05Identifier,
      },
    };
  }

  // Case 3: Input is a bare npub (no name)
  if (trimmed.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type !== 'npub') {
        throw new Error(`Expected npub but got ${decoded.type}`);
      }
      const pubkey = decoded.data as string;

      // Build naddr without identifier (empty string)
      const naddr = nip19.naddrEncode({
        kind: 30617,
        pubkey,
        identifier: '',
        relays: [],
      });

      return {
        input: trimmed,
        naddr,
        parts: {
          pubkey,
          npub: trimmed,
        },
      };
    } catch (error) {
      throw new Error(`Failed to decode npub: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Case 4: Input is a bare hex pubkey (no name)
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    const pubkey = trimmed.toLowerCase();
    const naddr = nip19.naddrEncode({
      kind: 30617,
      pubkey,
      identifier: '',
      relays: [],
    });

    return {
      input: trimmed,
      naddr,
      parts: {
        pubkey,
        npub: nip19.npubEncode(pubkey),
      },
    };
  }

  // Case 5: Input is a bare nip-05 (no name)
  if (trimmed.includes('@')) {
    try {
      const resolved = await nip05.queryProfile(trimmed);
      if (!resolved || !resolved.pubkey) {
        throw new Error(`Failed to resolve NIP-05 identifier: ${trimmed}`);
      }
      const pubkey = resolved.pubkey;
      const naddr = nip19.naddrEncode({
        kind: 30617,
        pubkey,
        identifier: '',
        relays: [],
      });

      return {
        input: trimmed,
        naddr,
        parts: {
          pubkey,
          npub: nip19.npubEncode(pubkey),
          nip05: trimmed,
        },
      };
    } catch (error) {
      throw new Error(`Failed to resolve NIP-05 ${trimmed}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Unrecognized format
  throw new Error(
    `Unrecognized repository key format: ${trimmed}. ` +
    `Expected one of: naddr, npub/name, pubkey/name, nip-05/name, or bare npub/pubkey/nip-05`
  );
}

/**
 * Synchronous version of normalizeRepoKey for cases where the input is known
 * to not require network resolution (naddr, npub/name, pubkey/name).
 *
 * @param input - Repository identifier (must not be nip-05)
 * @returns Normalized repository key
 * @throws Error if input requires network resolution or is invalid
 */
export function normalizeRepoKeySync(input: RepoKeyInput): NormalizedRepoKey {
  if (!input || typeof input !== 'string') {
    throw new Error('Invalid input: must be a non-empty string');
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Invalid input: empty string after trimming');
  }

  // Reject nip-05 formats (require async resolution)
  if (trimmed.includes('@')) {
    throw new Error('Cannot synchronously normalize NIP-05 identifiers (requires network lookup)');
  }

  // For all other formats, we can normalize synchronously
  // This is a simplified version that doesn't handle nip-05
  
  // Case 1: naddr
  if (trimmed.startsWith('naddr1')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type !== 'naddr') {
        throw new Error(`Expected naddr but got ${decoded.type}`);
      }

      const data = decoded.data as nip19.AddressPointer;
      
      if (data.kind !== 30617) {
        throw new Error(`Invalid kind ${data.kind}, expected 30617`);
      }

      return {
        input: trimmed,
        naddr: trimmed,
        parts: {
          pubkey: data.pubkey,
          npub: nip19.npubEncode(data.pubkey),
          name: data.identifier || undefined,
        },
      };
    } catch (error) {
      throw new Error(`Failed to decode naddr: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Case 2: npub/name or pubkey/name
  if (trimmed.includes('/')) {
    const [identifierPart, namePart] = trimmed.split('/');
    
    if (!identifierPart || !namePart) {
      throw new Error('Invalid format: slash-separated input must have both identifier and name');
    }

    let pubkey: string;

    if (identifierPart.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(identifierPart);
        if (decoded.type !== 'npub') {
          throw new Error(`Expected npub but got ${decoded.type}`);
        }
        pubkey = decoded.data as string;
      } catch (error) {
        throw new Error(`Failed to decode npub: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (/^[0-9a-f]{64}$/i.test(identifierPart)) {
      pubkey = identifierPart.toLowerCase();
    } else {
      throw new Error(`Invalid identifier format: ${identifierPart}`);
    }

    const naddr = nip19.naddrEncode({
      kind: 30617,
      pubkey,
      identifier: namePart,
      relays: [],
    });

    return {
      input: trimmed,
      naddr,
      parts: {
        pubkey,
        npub: nip19.npubEncode(pubkey),
        name: namePart,
      },
    };
  }

  // Case 3: bare npub
  if (trimmed.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type !== 'npub') {
        throw new Error(`Expected npub but got ${decoded.type}`);
      }
      const pubkey = decoded.data as string;

      const naddr = nip19.naddrEncode({
        kind: 30617,
        pubkey,
        identifier: '',
        relays: [],
      });

      return {
        input: trimmed,
        naddr,
        parts: {
          pubkey,
          npub: trimmed,
        },
      };
    } catch (error) {
      throw new Error(`Failed to decode npub: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Case 4: bare hex pubkey
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    const pubkey = trimmed.toLowerCase();
    const naddr = nip19.naddrEncode({
      kind: 30617,
      pubkey,
      identifier: '',
      relays: [],
    });

    return {
      input: trimmed,
      naddr,
      parts: {
        pubkey,
        npub: nip19.npubEncode(pubkey),
      },
    };
  }

  throw new Error(
    `Unrecognized repository key format: ${trimmed}. ` +
    `Expected one of: naddr, npub/name, pubkey/name, or bare npub/pubkey`
  );
}
