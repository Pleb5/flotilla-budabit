import type { BookmarkAddress } from "@nostr-git/core/events";
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
  maintainers: string[];
  refs: any;
  title: string;
  description: string;
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

    const getTaggedMaintainers = (event: any): string[] => {
      const raw = (event?.tags || [])
        .filter((t: string[]) => t[0] === "maintainers")
        .flatMap((t: string[]) => t.slice(1));
      return Array.from(new Set(raw.filter((pk: string) => isValidPubkey(pk))));
    };

    const getRepoMaintainers = (event: any, tagged: string[]): string[] => {
      const maintainers = new Set<string>();
      if (isValidPubkey(event?.pubkey)) maintainers.add(event.pubkey);
      for (const pk of tagged) maintainers.add(pk);

      return Array.from(maintainers);
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
      const declaredMaintainers = getTaggedMaintainers(first);
      try {
        if (first) {
          const parsed = parseRepoAnnouncementEvent(first);
          if (parsed?.name) title = parsed.name;
          if (parsed?.description) description = parsed.description;
        }
      } catch {}
      const maintainers = getRepoMaintainers(first, declaredMaintainers);
      // Compute principal maintainer and naddr for navigation
      // Use first valid maintainer, or fall back to event pubkey if valid
      const principal =
        maintainers.length > 0 && isValidPubkey(maintainers[0] as string)
          ? maintainers[0]
          : isValidPubkey((first as any)?.pubkey)
            ? (first as any)?.pubkey
            : "";
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
        maintainers: maintainers.filter((pk: any) => isValidPubkey(pk)) as string[],
        refs,
        title,
        description,
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
