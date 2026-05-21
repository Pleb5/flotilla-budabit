import type { Event as NostrEvent } from "nostr-tools"
import {
    DEFAULT_GRASP_SET_ID,
    GRASP_SET_KIND,
    type GraspSetEvent,
    type GraspSetTag,
} from "./nip51.js"

// Derive bookmarked addresses from the singleton bookmarksStore
export type BookmarkAddress = {
    address: string
    author: string
    identifier: string
    relayHint: string
}


export function validateGraspServerUrl(url: string): boolean {
    try {
        const u = new URL(url);
        // Allow ws(s) and http(s) because GRASP may use both for different endpoints
        if (!['ws:', 'wss:', 'http:', 'https:'].includes(u.protocol)) return false;
        const host = u.hostname.toLowerCase();
        const pathSegments = u.pathname.split('/').filter(Boolean);
        const lastSegment = pathSegments[pathSegments.length - 1] || '';
        if (['github.com', 'gitlab.com', 'bitbucket.org'].includes(host)) return false;
        if (pathSegments.length >= 2 && /\.git$/i.test(lastSegment)) return false;
        return true;
    } catch (_) {
        return false;
    }
}

export function normalizeGraspServerUrl(url: string): string {
    // trim and remove trailing slashes
    return url.trim().replace(/\/$/, '');
}

export function createGraspServersEvent(opts: {
    pubkey: string;
    urls: string[];
}): GraspSetEvent {
    const { pubkey, urls } = opts;
    const created_at = Math.floor(Date.now() / 1000);

    const clean = Array.from(new Set(urls.map(normalizeGraspServerUrl))).filter(
        validateGraspServerUrl
    );
    const content = JSON.stringify({ urls: clean });
    const tags: GraspSetTag[] = [
        ['d', DEFAULT_GRASP_SET_ID],
    ];
    return { kind: GRASP_SET_KIND, created_at, tags, content, pubkey } as GraspSetEvent;
}

// Parse a GRASP servers set event content into validated, normalized URLs
export function parseGraspServersEvent(evt: NostrEvent): string[] {
    try {
        if (!evt || !evt.content) return [];
        const parsed = JSON.parse(evt.content);
        const urls: string[] = Array.isArray(parsed?.urls) ? parsed.urls : [];
        return urls.map(normalizeGraspServerUrl).filter(validateGraspServerUrl);
    } catch (_) {
        return [];
    }
}
