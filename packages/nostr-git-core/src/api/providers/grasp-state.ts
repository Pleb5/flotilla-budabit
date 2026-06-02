/**
 * GRASP Repository State Management Helper
 *
 * Provides utilities for working with GRASP repository state events (kind 31990).
 * Based on implementation patterns observed in ngit repo_state.rs.
 */

import { nip19 } from 'nostr-tools';
/**
 * Encode repository address from hex pubkey and repo name.
 * Format: <npub>:<repo-name>
 *
 * Based on ngit's canonical address handling in repo_state.rs
 */
export function encodeRepoAddress(pubkeyHex: string, repo: string): string {
  const npub = nip19.npubEncode(pubkeyHex);
  return `${npub}:${repo}`;
}

/**
 * Parse repository address from canonical format
 * Format: <npub>:<repo-name>
 *
 * Mirrors ngit's parseRepoAddress functionality
 */
export function parseRepoAddress(address: string): { npub: string; repo: string } {
  const parts = address.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid repository address format: ${address}`);
  }
  const [npub, repo] = parts;
  if (!npub || !repo) {
    throw new Error(`Invalid repository address format: ${address}`);
  }
  return { npub, repo };
}



/**
 * Extract default branch name from HEAD reference.
 *
 * Based on ngit's add_head() function in repo_state.rs:
 * - Prefers refs/heads/main, then refs/heads/master
 * - Falls back to first available refs/heads/ branch
 */
export function getDefaultBranchFromHead(head: string): string {
  if (head.startsWith('refs/heads/')) {
    return head.substring('refs/heads/'.length);
  }
  return 'main'; // fallback
}

/**
 * Check if a ref name is a nostr reference.
 */
export function isNostrRef(refName: string): boolean {
  return refName.startsWith('refs/nostr/');
}

/**
 * Extract event ID from nostr ref name.
 */
export function getEventIdFromNostrRef(refName: string): string | null {
  if (isNostrRef(refName)) {
    return refName.substring('refs/nostr/'.length);
  }
  return null;
}

/**
 * Create nostr ref name from event ID.
 */
export function createNostrRefName(eventId: string): string {
  return `refs/nostr/${eventId}`;
}

/**
 * Normalize a push target to handle nostr refs.
 * Converts nostr/<event-id> to refs/nostr/<event-id> format.
 */
export function normalizePushTarget(target: string): string {
  if (target.startsWith('nostr/')) {
    return `refs/nostr/${target.substring(6)}`;
  }
  if (target.startsWith('refs/nostr/')) {
    return target;
  }
  return target;
}

/**
 * Parse a push target to determine if it's a nostr ref.
 */
export function parsePushTarget(target: string): {
  type: 'ref' | 'nostr';
  refname?: string;
  eventId?: string;
} {
  const normalized = normalizePushTarget(target);
  
  if (normalized.startsWith('refs/nostr/')) {
    const eventId = normalized.substring('refs/nostr/'.length);
    return {
      type: 'nostr',
      refname: normalized,
      eventId
    };
  }
  
  return {
    type: 'ref',
    refname: normalized
  };
}