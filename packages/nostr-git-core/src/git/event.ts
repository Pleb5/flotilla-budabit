import { nip19, type EventTemplate, type NostrEvent } from 'nostr-tools';
import { fetchPermalink, produceGitDiffFromPermalink } from './git.js';
import { parsePermalink, type PermalinkData } from './permalink.js';
import type { EventIO } from '../types/index.js';
import { getTagValue, getTag } from '../events/index.js';


export type HexString = Uint8Array<ArrayBufferLike>;

/**
 * Creates a NIP-34 permalink event from a URL - CLEAN VERSION
 * Uses EventIO instead of passing signers around
 *
 * @param permalink - The permalink, as copied directly from GitHub/Gitea/GitLab.
 * @param eventIO - EventIO instance for publishing events
 * @param relays - The relays to query for existing git repos
 * @returns a signed permalink @NostrEvent
 */
export async function createEventFromPermalink(
  permalink: string,
  eventIO: EventIO,
  relays: string[]
): Promise<NostrEvent> {
  const linkData = parsePermalink(permalink);
  if (!linkData) {
    throw new Error(`Could not parse permalink: ${permalink}`);
  }
  
  // Check for existing events using EventIO
  const exists = await permalinkEventExists(linkData, relays, eventIO);
  if (exists) {
    return exists;
  }
  
  const eventTemplate = await createEvent(linkData, relays);
  // Use EventIO to publish (handles signing internally)
  const result = await eventIO.publishEvent(eventTemplate);
  if (!result.ok) {
    throw new Error(`Failed to publish event: ${result.error}`);
  }
  
  // Return the signed event (we need to reconstruct it from the template)
  // This is a limitation of the current EventIO interface
  // TODO: EventIO should return the signed event
  return eventTemplate as NostrEvent;
}

export async function createNeventFromPermalink(
  permalink: string,
  eventIO: EventIO,
  relays: string[]
): Promise<string> {
  const event = await createEventFromPermalink(permalink, eventIO, relays);

  // Use EventIO to publish (delegates to app's infrastructure)
  const result = await eventIO.publishEvent(event);
  if (!result.ok) {
    throw new Error(`Failed to publish event: ${result.error}`);
  }

  const nevent = nip19.neventEncode({
    id: event.id,
    relays,
    author: event.pubkey,
    kind: event.kind
  });
  return `nostr:${nevent}`;
}

async function createEvent(eventData: PermalinkData, relays: string[]): Promise<EventTemplate> {
  const content = eventData.isDiff
    ? await produceGitDiffFromPermalink(eventData)
    : await fetchPermalink(eventData);

  const tags: string[][] = [
    ['repo', `https://${eventData.host}/${eventData.owner}/${eventData.repo}.git`],
    ['branch', eventData.branch],
    ['file', eventData.filePath]
  ];

  if (eventData.startLine) {
    const lineTag = ['lines', `${eventData.startLine}`];
    if (eventData.endLine) {
      lineTag.push(`${eventData.endLine}`);
    }
    tags.push(lineTag);
  }

  // if we have a valid repo name, attempt to link the repository event (kind 30617)
  // e.g. storing a reference to it in an 'a' tag if found
  // Note: This requires EventIO to be passed through the call chain
  // For now, we skip this lookup to avoid breaking the API
  // TODO: Add EventIO parameter to createEvent and enable this lookup
  // if (eventData.repo) {
  //   const repoEvent = await fetchRepoEvent(eventData, relays, io);
  //   if (repoEvent) {
  //     const repoId = getTagValue(repoEvent as any, 'd');
  //     if (repoId) {
  //       tags.push(['a', `30617:${repoEvent.pubkey}:${repoId}`]);
  //     }
  //   }
  // }

  return {
    kind: 1623,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content
  };
}

async function fetchRepoEvent(
  linkData: PermalinkData,
  relays: string[],
  io: EventIO
): Promise<NostrEvent | undefined> {
  try {
    // Use EventIO to fetch events (delegates to app's infrastructure)
    const events = await io.fetchEvents([{
      kinds: [30617],
      '#d': [linkData.repo]
    }]);
    // find event referencing a 'clone' tag that includes "owner/repo"
    const found = events.find((evt) =>
      evt.tags.some((t) => t[0] === 'clone' && t[1].includes(`${linkData.owner}/${linkData.repo}`))
    );
    return found;
  } catch (err) {
    console.error('fetchRepoEvent failed:', err);
    return undefined;
  }
}

async function permalinkEventExists(
  linkData: PermalinkData,
  relays: string[],
  io: EventIO
): Promise<NostrEvent | undefined> {
  try {
    // Use EventIO to fetch events (delegates to app's infrastructure)
    const events = await io.fetchEvents([{
      kinds: [1623],
      '#a': [linkData.repo] // searching for 'a' tag that matches repo
    }]);

    // filter or find an event that has matching branch, file, lines
    const found = events.find((evt) => {
      const hasBranch = getTagValue(evt as any, 'branch') === linkData.branch;
      const hasFile = getTagValue(evt as any, 'file') === linkData.filePath;

      // handle optional line range
      if (linkData.startLine) {
        const linesTag = getTag(evt as any, 'lines');
        const hasStart = linesTag?.[1] === linkData.startLine!.toString();
        if (!hasStart) return false;

        // if endLine also present, check for lines[2] = linkData.endLine
        if (linkData.endLine) {
          // The "lines" tag might store them as [ 'lines', start, end ]
          const hasEnd = linesTag?.[2] === linkData.endLine!.toString();
          if (!hasEnd) return false;
        }
      }

      return hasBranch && hasFile;
    });
    return found;
  } catch (err) {
    console.error('permalinkEventExists error:', err);
    return undefined;
  }
}
