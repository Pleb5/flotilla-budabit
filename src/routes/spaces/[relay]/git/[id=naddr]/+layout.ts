import { derived, get, type Readable } from 'svelte/store';
import {
    type CommentEvent,
    type IssueEvent,
    type PatchEvent,
} from '@nostr-git/shared-types';
import { GIT_ISSUE, GIT_PATCH } from '@welshman/util';
import { nip19 } from 'nostr-tools';
import type { AddressPointer } from 'nostr-tools/nip19';
import { nthEq } from '@welshman/lib';
import { GIT_REPO, GIT_REPO_STATE } from '@src/lib/util.js';
import { browser } from '$app/environment';

export const ssr = false;

export async function load({ params }) {
    const { id, relay } = params;

    // Only import and use browser-specific modules when in browser context
    if (!browser) {
        // Return minimal data for SSR
        return {
            repoClass: null,
            eventStore: null,
            relays: null,
            url: null,
            repoId: null,
            functionRegistry: undefined,
        };
    }

    // Dynamic imports to avoid SSR issues
    const { deriveNaddrEvent, decodeRelay, INDEXER_RELAYS } = await import('@app/state');
    const { deriveEvents } = await import('@welshman/store');
    const { publishThunk, repository } = await import('@welshman/app');
    const { load } = await import("@welshman/net");
    const { Repo } = await import('@nostr-git/ui'); // Make Repo import dynamic

    const decoded = nip19.decode(id).data as AddressPointer;
    const repoId = decoded.identifier;
    const url = decodeRelay(relay);

    const eventStore = deriveNaddrEvent(id, Array.isArray(relay) ? relay : [relay]);

    const fallbackRelays = INDEXER_RELAYS
    const relayList = decoded.relays?.length! > 0 ? decoded.relays : fallbackRelays

    const filters = [{
        authors: [decoded.pubkey],
        kinds: [GIT_REPO_STATE, GIT_REPO],
        "#d": [decoded.identifier],
    }]

    load({ relays: relayList as string[], filters })

    // Combine the separate event stores
    const repoAnnouncementEvents = deriveEvents(repository, {
        filters: [{
            authors: [decoded.pubkey],
            kinds: [GIT_REPO],
            "#d": [decoded.identifier],
        }]
    });

    const repoStateEvents = deriveEvents(repository, {
        filters: [{
            authors: [decoded.pubkey],
            kinds: [GIT_REPO_STATE],
            "#d": [decoded.identifier],
        }]
    });

    const repoEvents = derived([repoAnnouncementEvents, repoStateEvents], ([announcements, states]) => {
        const combined = [...(announcements || []), ...(states || [])];
        return combined;
    });

    // Get relays from event tags
    const relays = derived(eventStore, $eventStore => {
        if ($eventStore) {
            const [_, ...relaysList] = $eventStore.tags.find(nthEq(0, "relays")) || [];
            return relaysList;
        }
        return undefined;
    });

    // Create derived stores for issues and patches
    const issues: Readable<IssueEvent[]> = derived(
        deriveEvents(repository, {
            filters: [{
                authors: [decoded.pubkey],
                kinds: [GIT_ISSUE],
                "#a": [`${GIT_REPO}:${decoded.pubkey}:${decoded.identifier}`],
            }],
        }),
        (events) => (events || []) as IssueEvent[]
    );

    const patches: Readable<PatchEvent[]> = derived(
        deriveEvents(repository, {
            filters: [{
                authors: [decoded.pubkey],
                kinds: [GIT_PATCH],
                "#a": [`${GIT_REPO}:${decoded.pubkey}:${decoded.identifier}`],
            }]
        }),
        (events) => (events || []) as PatchEvent[]
    );

    const functionRegistry = {
        postComment: (comment: CommentEvent) => {
            return publishThunk({
                relays: get(relays) ?? [],
                event: comment,
            });
        },

        postIssue: (issue: IssueEvent) => {
            return publishThunk({
                relays: get(relays) ?? [],
                event: issue,
            });
        },
    };

    const repoClass = new Repo({
        repoEvents,
        issues,
        patches,
    });

    return {
        repoClass,
        eventStore,
        relays,
        url,
        repoId,
        functionRegistry,
    };
}
