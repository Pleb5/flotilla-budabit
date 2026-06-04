import { nip19 } from 'nostr-tools';
import type { RepoContext, RepoContextNormalized } from './types';

/**
 * Resolve the `kind:pubkey:d-tag` coordinate used in `#a` filters.
 *
 * Hosts are expected to provide `repo.address` in coordinate form. If only
 * a bech32 naddr is available we decode it. Any value that already matches
 * the coordinate shape is passed through unchanged.
 */
function resolveRepoAddress(repo: any): string | undefined {
  const candidate = repo?.address || repo?.repoAddress;
  if (typeof candidate === 'string' && candidate.includes(':')) return candidate;

  const naddr = repo?.naddr || repo?.repoNaddr;
  if (typeof naddr !== 'string') return undefined;
  if (naddr.includes(':')) return naddr;

  try {
    const decoded = nip19.decode(naddr);
    if (decoded.type === 'naddr') {
      const { kind, pubkey, identifier } = decoded.data;
      return `${kind}:${pubkey}:${identifier}`;
    }
  } catch {
    // fall through
  }
  return undefined;
}

export function transformHostContext(hostCtx: any): RepoContext {
  const repo = hostCtx?.repo || hostCtx;

  const result: RepoContext = {
    contextId: hostCtx?.contextId,
    userPubkey: hostCtx?.userPubkey,
    relays: hostCtx?.relays || repo?.relays || repo?.repoRelays || [],
    repo: repo
      ? {
          repoPubkey: repo?.pubkey || repo?.repoPubkey || '',
          repoName: repo?.name || repo?.repoName || '',
          repoAddress: resolveRepoAddress(repo),
          repoRelays: repo?.relays || repo?.repoRelays || [],
          maintainers: repo?.maintainers || [],
        }
      : undefined,
  };

  console.log('[pipelines] transformHostContext:', {
    inputKeys: Object.keys(hostCtx || {}),
    repoPubkey: result.repo?.repoPubkey?.slice(0, 12),
    repoName: result.repo?.repoName,
    repoAddress: result.repo?.repoAddress,
    relayCount: result.repo?.repoRelays?.length,
  });

  return result;
}

export function normalizeRepo(ctx: RepoContext | null): RepoContextNormalized | null {
  const repo = ctx?.repo;
  if (!repo?.repoPubkey || !repo?.repoName) return null;

  const fallbackRelays = Array.isArray(ctx?.relays)
    ? ctx.relays.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];

  const repoRelays = Array.isArray(repo.repoRelays)
    ? repo.repoRelays.filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      )
    : fallbackRelays;

  return {
    contextId: ctx?.contextId,
    userPubkey: ctx?.userPubkey,
    repoPubkey: repo.repoPubkey,
    repoName: repo.repoName,
    repoAddress: repo.repoAddress,
    repoRelays,
    maintainers: Array.isArray(repo.maintainers) ? repo.maintainers : undefined,
  };
}

export function getHostOrigin(): string {
  if (document.referrer) {
    try {
      return new URL(document.referrer).origin;
    } catch {
      // pass
    }
  }

  return '*';
}

export function friendlyErrorMessage(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('timed out')) {
    return 'Loading took too long. Try refreshing the Pipelines tab.';
  }

  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Network error while loading pipeline data.';
  }

  if (lower.includes('permission') || lower.includes('denied')) {
    return 'The widget does not have permission for that action.';
  }

  return message.length > 140 ? `${message.slice(0, 140)}…` : message;
}
