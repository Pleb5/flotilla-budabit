import type { BookmarkAddress } from "@nostr-git/core/events";
import type { RepoCommunityBinding } from "@nostr-git/core/events";
import { buildRepoNaddrFromEvent } from "@nostr-git/core/utils";

// Singleton store for bookmarked repositories
function createBookmarksStore() {
  const subscribers = new Set<(v: BookmarkAddress[]) => void>();
  let value: BookmarkAddress[] = [];

  function notify() {
    for (const run of subscribers) run(value);
  }

  function subscribe(run: (v: BookmarkAddress[]) => void) {
    run(value);
    subscribers.add(run);
    return () => subscribers.delete(run);
  }

  function set(next: BookmarkAddress[]) {
    value = Array.isArray(next) ? next : [];
    notify();
  }

  function update(fn: (v: BookmarkAddress[]) => BookmarkAddress[]) {
    value = fn(value);
    notify();
  }

  return {
    subscribe,
    set,
    update,
    add: (repo: BookmarkAddress) =>
      update((repos) => (repos.some((r) => r.address === repo.address) ? repos : [...repos, repo])),
    remove: (address: string) => update((repos) => repos.filter((r) => r.address !== address)),
    clear: () => set([]),
  };
}

// Export singleton instance
export const bookmarksStore = createBookmarksStore();

export type RepoCard = {
  euc: string;
  web: string[];
  clone: string[];
  owner: string;
  refs: any;
  title: string;
  description: string;
  community?: RepoCommunityBinding;
  first: any;
  principal: string;
  repoNaddr: string;
};

export type LoadedBookmarkedRepo = {
  address: string;
  event: any;
  relayHint: string;
};

export type ComputeCardsOptions = {
  parseRepoAnnouncementEvent: (event: any) => any;
  Router: any;
  Address: any;
  gitRelays?: string[];
};

// Minimal singleton repositories store that holds RepoCard[]
function createRepositoriesStore() {
  const subscribers = new Set<(v: RepoCard[]) => void>();
  let value: RepoCard[] = [];

  function notify() {
    for (const run of subscribers) run(value);
  }

  function subscribe(run: (v: RepoCard[]) => void) {
    run(value);
    subscribers.add(run);
    return () => subscribers.delete(run);
  }

  function set(next: RepoCard[]) {
    value = Array.isArray(next) ? next : [];
    notify();
  }

  function update(fn: (v: RepoCard[]) => RepoCard[]) {
    value = fn(value);
    notify();
  }

  function computeCards(
    loadedBookmarkedRepos: LoadedBookmarkedRepo[],
    options: ComputeCardsOptions
  ): RepoCard[] {
    const { parseRepoAnnouncementEvent, Router } = options;

    // Validate that a string is a valid hex pubkey (exactly 64 hex characters)
    const isValidPubkey = (pubkey: string | undefined | null): boolean => {
      if (!pubkey || typeof pubkey !== "string") return false;
      return /^[0-9a-f]{64}$/i.test(pubkey);
    };

    const bookmarked = loadedBookmarkedRepos || [];
    const byAddress = new Map<string, RepoCard>();

    for (const { event } of bookmarked) {
      const eucTag = (event.tags || []).find((t: string[]) => t[0] === "r" && t[2] === "euc");
      const anyRTag = (event.tags || []).find((t: string[]) => t[0] === "r");
      const euc = eucTag?.[1] || anyRTag?.[1] || event.id || "";
      const d = (event.tags || []).find((t: string[]) => t[0] === "d")?.[1] || "";
      const name = (event.tags || []).find((t: string[]) => t[0] === "name")?.[1] || "";
      const address = event.kind && event.pubkey && d ? `${event.kind}:${event.pubkey}:${d}` : event.id;
      if (!address) continue;

      // Extract event data
      const web = (event.tags || [])
        .filter((t: string[]) => t[0] === "web")
        .flatMap((t: string[]) => t.slice(1));
      const clone = (event.tags || [])
        .filter((t: string[]) => t[0] === "clone")
        .flatMap((t: string[]) => t.slice(1));

      let refs = {};
      const first = event;
      let title = name || d || euc;
      let description = "";
      let community: RepoCommunityBinding | undefined;
      try {
        if (first) {
          const parsed = parseRepoAnnouncementEvent(first);
          if (parsed?.name) title = parsed.name;
          if (parsed?.description) description = parsed.description;
          community = parsed?.community;
        }
      } catch {}
      const owner = isValidPubkey((first as any)?.pubkey) ? (first as any).pubkey : "";
      const principal = owner;
      const repoNaddr = (() => {
        try {
          if (!principal || !title) return "";
          const userOutboxRelays = Router.get().FromUser().getUrls();
          return (
            buildRepoNaddrFromEvent({
              event: first,
              fallbackPubkey: principal,
              userOutboxRelays,
              gitRelays: options.gitRelays || [],
            }) || ""
          );
        } catch {
          return "";
        }
      })();

      const card: RepoCard = {
        euc,
        web: Array.from(new Set(web)) as string[],
        clone: Array.from(new Set(clone)) as string[],
        owner,
        refs,
        title,
        description,
        community,
        first,
        principal,
        repoNaddr,
      };
      byAddress.set(address, card);
    }

    return Array.from(byAddress.values());
  }

  return {
    subscribe,
    set,
    update,
    clear: () => set([]),
    computeCards,
  };
}

export const repositoriesStore = createRepositoriesStore();
