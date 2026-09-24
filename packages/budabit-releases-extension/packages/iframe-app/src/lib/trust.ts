import { verifyEvent } from 'nostr-tools/pure';
import type { NostrEvent } from 'budabit-sdk';
import { HEX_KEY, record, type RepoContext } from './context.js';
import type { SoftwareApplication } from './types.js';

// Only this module can admit records. IDs and nostr-tools' public verification symbol
// are NOT membership proofs. Owned records (including every tag) are immutable.
const ownedEvents = new WeakSet();

/** Verify external input once; reuse only our immutable, already-verified records. */
export function verifiedEvent(input: unknown): NostrEvent | null {
  if (typeof input === 'object' && input !== null && ownedEvents.has(input))
    return input as NostrEvent;
  const value = record(input);
  try {
    const event = {
      id: value.id,
      pubkey: value.pubkey,
      sig: value.sig,
      kind: value.kind,
      created_at: value.created_at,
      content: value.content,
      tags: value.tags,
    } as NostrEvent;
    if (
      !HEX_KEY.test(event.id) ||
      !HEX_KEY.test(event.pubkey) ||
      !/^[0-9a-f]{128}$/.test(event.sig) ||
      !Number.isSafeInteger(event.created_at) ||
      event.created_at < 0 ||
      event.created_at > Math.floor(Date.now() / 1000) + 60 ||
      !Number.isSafeInteger(event.kind) ||
      typeof event.content !== 'string' ||
      event.content.length > 100_000 ||
      !Array.isArray(event.tags) ||
      event.tags.length > 2000 ||
      event.tags.some((t) => !Array.isArray(t) || t.some((value) => typeof value !== 'string'))
    )
      return null;
    event.tags = event.tags.map((t) => [...t]);
    if (!verifyEvent(event)) return null;
    for (const t of event.tags) Object.freeze(t);
    Object.freeze(event.tags);
    Object.freeze(event);
    ownedEvents.add(event);
    return event;
  } catch {
    return null;
  }
}

export const tag = (event: NostrEvent, key: string): string | undefined =>
  event.tags.find((t) => t[0] === key)?.[1];
export const coordinate = (event: NostrEvent): string =>
  `${event.kind}:${event.pubkey}:${tag(event, 'd') ?? ''}`;
export const appCoordinate = (app: SoftwareApplication): string =>
  `32267:${app.pubkey}:${app.appId}`;

export function replacements(events: Iterable<NostrEvent>): NostrEvent[] {
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    const key = coordinate(event);
    const old = latest.get(key);
    if (
      !old ||
      event.created_at > old.created_at ||
      (event.created_at === old.created_at && event.id < old.id)
    )
      latest.set(key, event);
  }
  return [...latest.values()].sort(
    (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)
  );
}

export function authorizedApplication(event: NostrEvent, repo: RepoContext): boolean {
  return (
    event.kind === 32267 &&
    !!verifiedEvent(event) &&
    repo.maintainers.includes(event.pubkey) &&
    !!tag(event, 'd') &&
    !!tag(event, 'name') &&
    event.tags.some((t) => t[0] === 'a' && t[1] === repo.repoAddress)
  );
}

export function authorizedRelease(
  event: NostrEvent,
  repo: RepoContext,
  apps: SoftwareApplication[]
): boolean {
  if (event.kind !== 30063 || !verifiedEvent(event) || !repo.maintainers.includes(event.pubkey))
    return false;
  const links = event.tags.filter((t) => t[0] === 'a' && t[1]?.startsWith('32267:'));
  const app = apps.find((a) => appCoordinate(a) === links[0]?.[1]);
  const version = tag(event, 'version');
  return (
    links.length === 1 &&
    !!app &&
    tag(event, 'i') === app.appId &&
    !!version &&
    tag(event, 'd') === `${app.appId}@${version}` &&
    !!tag(event, 'c') &&
    event.tags.some((t) => t[0] === 'e' && HEX_KEY.test(t[1] ?? ''))
  );
}
