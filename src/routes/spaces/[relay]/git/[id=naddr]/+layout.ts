export const ssr = false;
import { derived, type Readable } from 'svelte/store';
import {
    type IssueEvent,
    type PatchEvent,
    type RepoAnnouncementEvent,
    type RepoStateEvent,
} from '@nostr-git/shared-types';
import { GIT_ISSUE, GIT_PATCH } from '@welshman/util';
import { nip19 } from 'nostr-tools';
import type { AddressPointer } from 'nostr-tools/nip19';
import { nthEq } from '@welshman/lib';
import { GIT_REPO, GIT_REPO_STATE } from '@src/lib/util.js';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ params }) => {
    const { id, relay } = params;

    // Dynamic imports to avoid SSR issues
    const { decodeRelay, INDEXER_RELAYS } = await import('@app/state');
    const { deriveEvents } = await import('@welshman/store');
    const { repository } = await import('@welshman/app');
    const { load } = await import("@welshman/net");
    const { Repo } = await import('@nostr-git/ui');

    const decoded = nip19.decode(id).data as AddressPointer;
    const repoId = decoded.identifier;
    const url = decodeRelay(relay);

    const fallbackRelays = INDEXER_RELAYS
    const relayListFromUrl = (decoded.relays?.length ?? 0) > 0
      ? decoded.relays as string[] 
      : fallbackRelays

    const filters = [{
        authors: [decoded.pubkey],
        kinds: [GIT_REPO_STATE, GIT_REPO],
        "#d": [decoded.identifier],
    }]

    await load({ relays: relayListFromUrl as string[], filters })

    const repoEvent = derived(deriveEvents(repository, {
        filters: [{
            authors: [decoded.pubkey],
            kinds: [GIT_REPO],
            "#d": [decoded.identifier],
        }]
    }), (events) => events[0]) as Readable<RepoAnnouncementEvent>;

    const repoStateEvent = derived(deriveEvents(repository, {
        filters: [{
            authors: [decoded.pubkey],
            kinds: [GIT_REPO_STATE],
            "#d": [decoded.identifier],
        }]
    }), (events) => events[0]) as Readable<RepoStateEvent>;

    // Get relays from event tags
    const bestRelayList = derived(repoEvent, re => {
        if (re) {
            const [_, ...relaysList] = re.tags.find(nthEq(0, "relays")) || [];
            return relaysList;
        }
        return relayListFromUrl;
    });

    const issueFilters = {
        kinds: [GIT_ISSUE],
        "#a": [`${GIT_REPO}:${decoded.pubkey}:${decoded.identifier}`],
    }

    const patchFilters = {
        kinds: [GIT_PATCH],
        "#a": [`${GIT_REPO}:${decoded.pubkey}:${decoded.identifier}`],
    }

    await load({ 
        relays: relayListFromUrl as string[], 
        filters: [issueFilters, patchFilters] 
    })

    // Create derived stores for issues and patches
    const issues: Readable<IssueEvent[]> = derived(
        deriveEvents(repository, {
            filters: [issueFilters],
        }),
        (events) => (events || []) as IssueEvent[]
    );

    const patches: Readable<PatchEvent[]> = derived(
        deriveEvents(repository, {
            filters: [patchFilters],
        }),
        (events) => (events || []) as PatchEvent[]
    );

    const repoClass = new Repo({
        repoEvent,
        repoStateEvent,
        issues,
        patches,
    });

    return {
        repoClass,
        repoRelays: bestRelayList,
        url,
        repoId,
    };
}
