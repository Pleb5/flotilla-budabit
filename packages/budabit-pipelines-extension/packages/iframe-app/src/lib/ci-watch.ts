import type { NostrSigner } from '@contextvm/sdk';
import { nip19 } from 'nostr-tools';
import type { WidgetBridge } from 'budabit-sdk';

/**
 * Adapts the host bridge to the ContextVM SDK's NostrSigner interface so the
 * Hive CI client can sign (and gift-wrap-decrypt) with the user's key without
 * the iframe ever seeing the secret.
 *
 * - getPublicKey: host-provided user pubkey from the repo context.
 * - signEvent:    host `nostr:sign` action (same unwrap as blossom.ts).
 * - nip44:        host `nostr:nip44Encrypt` / `nostr:nip44Decrypt` actions.
 *   Decrypt is required — CI server responses arrive NIP-59 gift-wrapped.
 */
export function bridgeNostrSigner(bridge: WidgetBridge, pubkey: string): NostrSigner {
  return {
    getPublicKey: async () => pubkey,

    signEvent: async (event) => {
      const res: any = await bridge.request('nostr:sign', event);
      if (res?.error) throw new Error(`nostr:sign failed: ${res.error}`);
      // Host returns either `{event}` or the signed event directly.
      const signed = res?.event ?? res;
      if (!signed || typeof signed.id !== 'string' || typeof signed.sig !== 'string') {
        throw new Error('nostr:sign returned an unsigned event');
      }
      return signed;
    },

    nip44: {
      encrypt: async (recipientPubkey, plaintext) => {
        const res: any = await bridge.request('nostr:nip44Encrypt', { recipientPubkey, plaintext });
        if (res?.error) throw new Error(`nostr:nip44Encrypt failed: ${res.error}`);
        const ciphertext = res?.ciphertext;
        if (typeof ciphertext !== 'string') {
          throw new Error('Host did not return ciphertext from NIP-44 encryption.');
        }
        return ciphertext;
      },
      decrypt: async (senderPubkey, ciphertext) => {
        const res: any = await bridge.request('nostr:nip44Decrypt', { senderPubkey, ciphertext });
        if (res?.error) throw new Error(`nostr:nip44Decrypt failed: ${res.error}`);
        const plaintext = res?.plaintext;
        if (typeof plaintext !== 'string') {
          throw new Error('Host did not return plaintext from NIP-44 decryption.');
        }
        return plaintext;
      },
    },
  };
}

const REPO_ADDR_RE = /^30617:[0-9a-f]{64}:/;
const PUBKEY_HEX_RE = /^[0-9a-f]{64}$/;

function looksLikeRepoAddr(value: unknown): value is string {
  return typeof value === 'string' && REPO_ADDR_RE.test(value);
}

function decodeNaddrToRepoAddr(value: string): string | undefined {
  if (!value.startsWith('naddr1')) return undefined;
  try {
    const decoded = nip19.decode(value);
    if (decoded.type === 'naddr') {
      const { kind, pubkey, identifier } = decoded.data;
      return `${kind}:${pubkey}:${identifier}`;
    }
  } catch {
    // not a valid naddr — ignore
  }
  return undefined;
}

/**
 * Best-effort normalization of the opaque `list_followed` tool output into a
 * list of `30617:pubkey:d-tag` coordinates. The output type is
 * `{[k: string]: unknown}`, so handle the plausible shapes:
 * - array of coordinate strings (or naddrs)
 * - array of objects carrying `repo_addr` / `address` / `naddr`
 * - array of objects carrying `repo_owner` + `d_tag`
 * - object map keyed by repo coordinate
 * - any of the above nested under `repos` / `followed` / `items`
 */
export function extractFollowedRepoAddrs(output: unknown): string[] {
  const addrs = new Set<string>();

  const collect = (value: unknown, depth: number) => {
    if (value == null || depth > 4) return;

    if (typeof value === 'string') {
      if (looksLikeRepoAddr(value)) {
        addrs.add(value);
      } else {
        const decoded = decodeNaddrToRepoAddr(value);
        if (decoded) addrs.add(decoded);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) collect(item, depth + 1);
      return;
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;

      for (const key of ['repo_addr', 'repoAddr', 'address', 'naddr']) {
        collect(record[key], depth + 1);
      }

      // {repo_owner, d_tag} pair — synthesize the coordinate.
      const owner = record['repo_owner'] ?? record['repoOwner'];
      const dTag = record['d_tag'] ?? record['dTag'];
      if (typeof owner === 'string' && PUBKEY_HEX_RE.test(owner) && typeof dTag === 'string') {
        addrs.add(`30617:${owner}:${dTag}`);
      }

      for (const [key, v] of Object.entries(record)) {
        if (looksLikeRepoAddr(key)) addrs.add(key);
        // Only descend into containers — scalar values were handled above.
        if (v !== null && typeof v === 'object') collect(v, depth + 1);
      }
    }
  };

  collect(output, 0);
  return [...addrs];
}

/**
 * The CI client throws `Error('Tool "list_followed" failed: <server text>')`
 * for tool-level failures. Match the auth-flavoured server messages so the UI
 * can show an "unauthorized" state instead of a generic error.
 */
export function isUnauthorizedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /unauthorized|not authorized|forbidden|denied|allow.?list|permission/i.test(message);
}
