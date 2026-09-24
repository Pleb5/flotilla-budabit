import { nip19 } from 'nostr-tools';

export const HEX_KEY = /^[0-9a-f]{64}$/;
export interface RepoContext {
  repoPubkey: string;
  /** Exact NIP-34 d-tag, never display text. */
  repoName: string;
  repoAddress: string;
  repoNaddr: string;
  repoRelays: string[];
  maintainers: string[];
  userPubkey: string;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function normalizeRelays(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((item: unknown) => {
        if (typeof item !== 'string') return [];
        try {
          const url = new URL(item);
          if (!['wss:', 'ws:'].includes(url.protocol) || url.username || url.password || url.hash)
            return [];
          return [url.href.replace(/\/$/, '')];
        } catch {
          return [];
        }
      })
    ),
  ];
}

/** Accept current runtime, flat repoUpdate, legacy envelope and getRepo response. */
export function normalizeContext(input: unknown, previousViewer = ''): RepoContext | null {
  const envelope = record(input);
  const raw =
    'repoContext' in envelope ? envelope.repoContext : 'repo' in envelope ? envelope.repo : input;
  const value = record(raw);
  const pubkey = value.repoPubkey ?? value.pubkey;
  const name = value.repoName ?? value.name;
  if (typeof pubkey !== 'string' || !HEX_KEY.test(pubkey) || typeof name !== 'string' || !name)
    return null;
  const address = `30617:${pubkey}:${name}`;
  if (
    (value.address !== undefined && value.address !== address) ||
    (value.repoAddress !== undefined && value.repoAddress !== address)
  )
    return null;
  const naddr = value.repoNaddr ?? value.naddr;
  let encoded = '';
  if (typeof naddr === 'string' && naddr && naddr !== address) {
    try {
      const decoded = nip19.decode(naddr);
      if (
        decoded.type !== 'naddr' ||
        decoded.data.kind !== 30617 ||
        decoded.data.pubkey !== pubkey ||
        decoded.data.identifier !== name
      )
        return null;
      encoded = naddr;
    } catch {
      return null;
    }
  }
  const viewer =
    'userPubkey' in envelope
      ? envelope.userPubkey
      : 'userPubkey' in value
        ? value.userPubkey
        : raw !== input && 'pubkey' in envelope
          ? envelope.pubkey
          : previousViewer;
  const maintainers = Array.isArray(value.maintainers)
    ? value.maintainers.filter((v): v is string => typeof v === 'string' && HEX_KEY.test(v))
    : [];
  return {
    repoPubkey: pubkey,
    repoName: name,
    repoAddress: address,
    repoNaddr: encoded,
    repoRelays: normalizeRelays(value.repoRelays ?? value.relays),
    maintainers: [...new Set([pubkey, ...maintainers])],
    userPubkey: typeof viewer === 'string' && HEX_KEY.test(viewer) ? viewer : '',
  };
}

export function isMaintainer(repo: RepoContext): boolean {
  return repo.maintainers.includes(repo.userPubkey);
}
