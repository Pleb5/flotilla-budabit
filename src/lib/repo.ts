import { derived, get } from 'svelte/store';
import { parseRepoAnnouncementEvent, type CommentEvent, type IssueEvent, type RepoAnnouncementEvent } from '@nostr-git/shared-types';
import { deriveNaddrEvent } from '@src/app/state';
import { deriveEvents } from '@welshman/store';
import { publishThunk, repository } from '@welshman/app';
import { GIT_ISSUE, GIT_PATCH, type Filter } from '@welshman/util';
import { Address } from '@welshman/util';
import { GIT_REPO_STATE } from '@src/lib/util';
import { nthEq } from '@welshman/lib';


export function createRepoModel({ id, relay }: { id: string; relay: string }) {
    const repoEvent = deriveNaddrEvent(id, Array.isArray(relay) ? relay : [relay]);

    const issues = derived(repoEvent, $repoEvent => {
        if (!$repoEvent) return [];
        const address = Address.fromEvent($repoEvent).toString();
        const issueFilter = [{ kinds: [GIT_ISSUE], "#a": [address] }];
        return deriveEvents(repository, { filters: issueFilter });
    });

    const patches = derived(repoEvent, $repoEvent => {
        if (!$repoEvent) return [];
        const address = Address.fromEvent($repoEvent).toString();
        const patchFilter = [{ kinds: [GIT_PATCH], "#a": [address], "#t": ["root"] }];
        return deriveEvents(repository, { filters: patchFilter });
    });

    const repoState = derived(repoEvent, $repoEvent => {
        if (!$repoEvent) return null;
        const repoAnn = parseRepoAnnouncementEvent($repoEvent as RepoAnnouncementEvent);
        const address = repoAnn.repoId;
        const repoStateFilter: Filter[] = [
            { kinds: [GIT_REPO_STATE], "#d": [address!] },
        ];
        return deriveEvents(repository, { filters: repoStateFilter });
    });

    const relays = derived(repoEvent, $repoEvent => {
        if ($repoEvent) {
            const [_, ...relays] = $repoEvent.tags.find(nthEq(0, "relays")) || [];
            return relays;
        }
    });

    function postComment(comment: CommentEvent) {
        const currentRelays = get(relays);
        if (!currentRelays?.length) {
            console.error('No relays available for posting comment');
            return Promise.reject('No relays available');
        }

        return publishThunk({
            relays: currentRelays,
            event: comment,
        });
    }

    function postIssue(issue: IssueEvent) {
        const currentRelays = get(relays);
        if (!currentRelays?.length) {
            console.error('No relays available for posting issue');
            return Promise.reject('No relays available');
        }

        return publishThunk({
            relays: currentRelays,
            event: issue,
        });
    }

    return {
        repoEvent,
        issues,
        patches,
        repoState,
        relays,
        postComment,
        postIssue,
    }
}