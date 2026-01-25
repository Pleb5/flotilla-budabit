/**
 * NIP-34 Repository Event Fixtures
 * Kind 30617: Repository Announcement
 * Kind 30618: Repository State
 */
import { nip19, getPublicKey, getEventHash, finalizeEvent } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// ============================================================================
// Test Keypairs
// ============================================================================
// These are deterministic test private keys (32 bytes each, hex encoded).
// Using real cryptographic keys allows events to pass signature verification.
// NEVER use these keys for real applications - they are public test keys.

/**
 * Pre-defined test private keys (hex-encoded 32-byte keys)
 * These generate valid Nostr keypairs for testing.
 */
export const TEST_PRIVATE_KEYS = {
  // Deterministic keys derived from simple patterns for reproducibility
  alice: '0101010101010101010101010101010101010101010101010101010101010101',
  bob: '0202020202020202020202020202020202020202020202020202020202020202',
  charlie: '0303030303030303030303030303030303030303030303030303030303030303',
  maintainer: '0404040404040404040404040404040404040404040404040404040404040404',
  // Dev login key used in E2E tests (matches LogInBunker.svelte DEV_LOGIN_SECRET)
  devUser: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
} as const;

// Test pubkeys derived from the private keys above
// These are the actual public keys corresponding to the private keys
export const TEST_PUBKEYS = {
  alice: getPublicKey(hexToBytes(TEST_PRIVATE_KEYS.alice)),
  bob: getPublicKey(hexToBytes(TEST_PRIVATE_KEYS.bob)),
  charlie: getPublicKey(hexToBytes(TEST_PRIVATE_KEYS.charlie)),
  maintainer: getPublicKey(hexToBytes(TEST_PRIVATE_KEYS.maintainer)),
  // Dev login pubkey - use this for repos that should appear in "My Repos" tab
  devUser: getPublicKey(hexToBytes(TEST_PRIVATE_KEYS.devUser)),
} as const;

/**
 * Get the private key for a given pubkey
 */
export function getPrivateKeyForPubkey(pubkey: string): Uint8Array | null {
  for (const [name, pk] of Object.entries(TEST_PUBKEYS)) {
    if (pk === pubkey) {
      return hexToBytes(TEST_PRIVATE_KEYS[name as keyof typeof TEST_PRIVATE_KEYS]);
    }
  }
  return null;
}

// Test commit hashes (40-char hex)
export const TEST_COMMITS = {
  initial: '0'.repeat(40),
  second: '1'.repeat(40),
  third: '2'.repeat(40),
  feature: '3'.repeat(40),
  merge: '4'.repeat(40),
} as const;

// Base timestamp for fixtures (2024-01-15 12:00:00 UTC)
export const BASE_TIMESTAMP = 1705320000;

/**
 * Unsigned Nostr event structure compatible with nostr-tools
 */
export interface UnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  pubkey?: string;
}

/**
 * Options for creating a Repository Announcement event (kind 30617)
 */
export interface RepoAnnouncementOptions {
  /** Repository identifier (d tag) - required */
  identifier: string;
  /** Repository name - required */
  name: string;
  /** Repository description */
  description?: string;
  /** Web URLs for the repository */
  web?: string[];
  /** Clone URLs (git, https, etc.) */
  clone?: string[];
  /** Relay URLs where events are published */
  relays?: string[];
  /** Maintainer pubkeys */
  maintainers?: string[];
  /** Earliest unique commit hash (r:euc tag) */
  earliestUniqueCommit?: string;
  /** Hashtags for categorization */
  hashtags?: string[];
  /** Event pubkey (author) */
  pubkey?: string;
  /** Event timestamp (seconds) */
  created_at?: number;
}

/**
 * Creates a Repository Announcement event (kind 30617)
 *
 * NIP-34 specifies this event announces a git repository on Nostr.
 * Required tags: d (identifier), name
 * Optional tags: description, web, clone, relays, maintainers, r:euc, t
 */
export function createRepoAnnouncement(opts: RepoAnnouncementOptions): UnsignedEvent {
  const tags: string[][] = [
    ['d', opts.identifier],
    ['name', opts.name],
  ];

  if (opts.description) {
    tags.push(['description', opts.description]);
  }

  if (opts.web && opts.web.length > 0) {
    tags.push(['web', ...opts.web]);
  }

  if (opts.clone && opts.clone.length > 0) {
    tags.push(['clone', ...opts.clone]);
  }

  if (opts.relays && opts.relays.length > 0) {
    tags.push(['relays', ...opts.relays]);
  }

  if (opts.maintainers && opts.maintainers.length > 0) {
    tags.push(['maintainers', ...opts.maintainers]);
  }

  if (opts.earliestUniqueCommit) {
    tags.push(['r', opts.earliestUniqueCommit, 'euc']);
  }

  if (opts.hashtags) {
    for (const tag of opts.hashtags) {
      tags.push(['t', tag]);
    }
  }

  return {
    kind: 30617,
    created_at: opts.created_at ?? BASE_TIMESTAMP,
    tags,
    content: '',
    pubkey: opts.pubkey ?? TEST_PUBKEYS.alice,
  };
}

/**
 * Reference type for repository state
 */
export interface RepoRef {
  type: 'heads' | 'tags';
  name: string;
  commit: string;
  /** Optional ancestry for lineage tracking */
  ancestry?: string[];
}

/**
 * Options for creating a Repository State event (kind 30618)
 */
export interface RepoStateOptions {
  /** Repository identifier (d tag) - required */
  identifier: string;
  /** Branch and tag refs */
  refs?: RepoRef[];
  /** HEAD reference (branch name, e.g., 'main') */
  head?: string;
  /** Event pubkey (author) */
  pubkey?: string;
  /** Event timestamp (seconds) */
  created_at?: number;
}

/**
 * Creates a Repository State event (kind 30618)
 *
 * NIP-34 specifies this event tracks the current state of refs (branches/tags).
 * Tags format: refs/heads/{branch} or refs/tags/{tag} with commit hash
 * HEAD tag: ref: refs/heads/{branch}
 */
export function createRepoState(opts: RepoStateOptions): UnsignedEvent {
  const tags: string[][] = [
    ['d', opts.identifier],
  ];

  // Add refs (branches and tags)
  if (opts.refs) {
    for (const ref of opts.refs) {
      const refPath = `refs/${ref.type}/${ref.name}`;
      if (ref.ancestry && ref.ancestry.length > 0) {
        tags.push([refPath, ref.commit, ...ref.ancestry]);
      } else {
        tags.push([refPath, ref.commit]);
      }
    }
  }

  // Add HEAD reference
  if (opts.head) {
    tags.push(['HEAD', `ref: refs/heads/${opts.head}`]);
  }

  return {
    kind: 30618,
    created_at: opts.created_at ?? BASE_TIMESTAMP,
    tags,
    content: '',
    pubkey: opts.pubkey ?? TEST_PUBKEYS.alice,
  };
}

// ============================================================================
// Pre-built Fixtures
// ============================================================================

/**
 * Minimal repository announcement with only required fields
 */
export const MINIMAL_REPO_ANNOUNCEMENT = createRepoAnnouncement({
  identifier: 'test-repo',
  name: 'Test Repository',
});

/**
 * Full repository announcement with all optional fields
 */
export const FULL_REPO_ANNOUNCEMENT = createRepoAnnouncement({
  identifier: 'flotilla-budabit',
  name: 'Flotilla Budabit',
  description: 'A Discord-like Nostr client with git collaboration features',
  web: ['https://github.com/example/flotilla-budabit', 'https://flotilla.dev'],
  clone: [
    'https://github.com/example/flotilla-budabit.git',
    'git@github.com:example/flotilla-budabit.git',
  ],
  relays: ['wss://relay.damus.io', 'wss://nos.lol'],
  maintainers: [TEST_PUBKEYS.alice, TEST_PUBKEYS.bob],
  earliestUniqueCommit: TEST_COMMITS.initial,
  hashtags: ['nostr', 'git', 'collaboration', 'svelte'],
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP,
});

/**
 * Repository announcement for a fork
 */
export const FORK_REPO_ANNOUNCEMENT = createRepoAnnouncement({
  identifier: 'flotilla-budabit-fork',
  name: 'Flotilla Budabit Fork',
  description: 'Personal fork with experimental features',
  clone: ['https://github.com/charlie/flotilla-budabit-fork.git'],
  relays: ['wss://relay.damus.io'],
  earliestUniqueCommit: TEST_COMMITS.initial, // Same EUC links to original
  pubkey: TEST_PUBKEYS.charlie,
  created_at: BASE_TIMESTAMP + 3600,
});

/**
 * Minimal repository state
 */
export const MINIMAL_REPO_STATE = createRepoState({
  identifier: 'test-repo',
});

/**
 * Repository state with main branch only
 */
export const SINGLE_BRANCH_REPO_STATE = createRepoState({
  identifier: 'test-repo',
  refs: [
    { type: 'heads', name: 'main', commit: TEST_COMMITS.initial },
  ],
  head: 'main',
});

/**
 * Repository state with multiple branches and tags
 */
export const FULL_REPO_STATE = createRepoState({
  identifier: 'flotilla-budabit',
  refs: [
    { type: 'heads', name: 'main', commit: TEST_COMMITS.third },
    { type: 'heads', name: 'develop', commit: TEST_COMMITS.feature },
    { type: 'heads', name: 'feature/nip34', commit: TEST_COMMITS.feature },
    { type: 'tags', name: 'v1.0.0', commit: TEST_COMMITS.initial },
    { type: 'tags', name: 'v1.1.0', commit: TEST_COMMITS.second },
    { type: 'tags', name: 'v2.0.0', commit: TEST_COMMITS.third },
  ],
  head: 'main',
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP,
});

/**
 * Repository state with ancestry lineage
 */
export const REPO_STATE_WITH_ANCESTRY = createRepoState({
  identifier: 'test-repo',
  refs: [
    {
      type: 'heads',
      name: 'main',
      commit: TEST_COMMITS.third,
      ancestry: [TEST_COMMITS.second, TEST_COMMITS.initial],
    },
  ],
  head: 'main',
});

/**
 * Generates a repo announcement address string (for 'a' tags)
 */
export function getRepoAddress(pubkey: string, identifier: string): string {
  return `30617:${pubkey}:${identifier}`;
}

/**
 * Encodes a repository address as an naddr bech32 string
 * This is required for URL routing in the app which uses [id=naddr] param matcher
 */
export function encodeRepoNaddr(pubkey: string, identifier: string, relays: string[] = []): string {
  return nip19.naddrEncode({
    kind: 30617,
    pubkey,
    identifier,
    relays,
  });
}

/**
 * Encodes an "a" tag address string to naddr
 * @param address - Format: "30617:pubkey:identifier"
 */
export function addressToNaddr(address: string, relays: string[] = []): string {
  const parts = address.split(':');
  if (parts.length !== 3) {
    throw new Error(`Invalid address format: ${address}. Expected "kind:pubkey:identifier"`);
  }
  const [kind, pubkey, identifier] = parts;
  return nip19.naddrEncode({
    kind: parseInt(kind, 10),
    pubkey,
    identifier,
    relays,
  });
}

/**
 * Test fixture for a complete repository with announcement and state
 */
export const TEST_REPO = {
  announcement: FULL_REPO_ANNOUNCEMENT,
  state: FULL_REPO_STATE,
  address: getRepoAddress(TEST_PUBKEYS.alice, 'flotilla-budabit'),
};

// ============================================================================
// Event Signing for E2E Tests
// ============================================================================

/**
 * Signed Nostr event with id and sig
 */
export interface SignedEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * Sign an unsigned event using the appropriate test private key.
 *
 * If the event's pubkey matches one of our test pubkeys, the corresponding
 * private key is used. Otherwise, a default key (alice) is used.
 *
 * @param event - The unsigned event to sign
 * @returns A fully signed event with id and sig
 */
export function signTestEvent(event: UnsignedEvent): SignedEvent {
  const pubkey = event.pubkey || TEST_PUBKEYS.alice;

  // Get the corresponding private key
  let privateKey = getPrivateKeyForPubkey(pubkey);
  if (!privateKey) {
    // If we don't have a matching private key, use alice's key
    // and update the pubkey to match
    privateKey = hexToBytes(TEST_PRIVATE_KEYS.alice);
  }

  // Create the event template
  const eventTemplate = {
    kind: event.kind,
    created_at: event.created_at,
    tags: event.tags,
    content: event.content,
  };

  // Use nostr-tools' finalizeEvent to sign it properly
  const signedEvent = finalizeEvent(eventTemplate, privateKey);

  return signedEvent as SignedEvent;
}
