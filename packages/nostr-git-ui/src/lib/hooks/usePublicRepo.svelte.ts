import {
  createRepoAnnouncementEvent,
  type RepoAnnouncementEvent,
  type RepoStateEvent,
} from "@nostr-git/core/events";
import { inspectPublicRepoSource, type PublicRepoSource } from "@nostr-git/core/git";
import { validateRepoDisplayName } from "@nostr-git/core/utils";
import { useRepoCopy, type ForkConfig, type UseForkRepoOptions } from "./useRepoCopy.svelte.js";
import {
  assertRepoCoordinateAvailable,
  assertRepoCreationPrerequisites,
  reserveRepoCreation,
} from "../utils/repo-creation-preflight.js";
import { extractPublishRelayAck, toNpubOrSelf } from "../utils/grasp-pipeline.js";
import { normalizeRelayUrl } from "../utils/remote-targets.js";
import {
  getPendingRepoCreationTransactions,
  isSideEffectFreeAnnouncement,
  RepoCreationTransactionJournal,
  trackRepoCreationPublisher,
} from "../utils/repo-creation-transaction.js";
import type { RemoteSyncTargetResult } from "../utils/remote-sync.js";
import type { NostrEvent } from "@nostr-git/core";
import {
  loadOwnerRepoAnnouncements,
  findSourceAnnouncements,
} from "../utils/repo-import-checks.js";

export interface PublicRepoResult {
  announcementEvent: RepoAnnouncementEvent;
  stateEvent?: RepoStateEvent;
  remotePushResults: RemoteSyncTargetResult[];
}

export interface PublicRepoConfig extends ForkConfig {
  source: PublicRepoSource;
  mode: "announce" | "copy";
  importAnyway?: boolean;
}

export interface UsePublicRepoOptions extends UseForkRepoOptions {
  ownerRepoRelays?: string[];
  getKnownOwnerRepoEvents?: (owner: string) => NostrEvent[];
}

/** Metadata-only announcements never initialize a Git worker or consult target tokens. */
export function usePublicRepo(options: UsePublicRepoOptions = {}) {
  const copy = useRepoCopy(options);
  let announcing = $state(false);
  let error = $state<string | null>(null);
  let complete = $state(false);
  let controller: AbortController | undefined;

  async function createRepository(config: PublicRepoConfig): Promise<PublicRepoResult | null> {
    if (announcing || copy.isForking) throw new Error("Repository operation is already running");
    announcing = true;
    complete = false;
    error = null;
    controller = new AbortController();
    const signal = controller.signal;
    let release: (() => void) | undefined;
    let journal: RepoCreationTransactionJournal | undefined;
    try {
      options.assertActor?.();
      // Recheck public identity at execution, never rely on an old metadata form or saved tokens.
      const source = await inspectPublicRepoSource(config.source.url, signal, {
        provider: config.source.provider,
      });
      options.assertActor?.();
      if (source.id !== config.source.id || source.cloneUrl !== config.source.cloneUrl)
        throw new Error("The source repository changed. Inspect it again before continuing");
      const owner = options.userPubkey || "";
      const checkRelays = [...(options.ownerRepoRelays || []), ...(config.relays || [])];
      const inventory = await loadOwnerRepoAnnouncements({
        owner,
        relays: checkRelays,
        knownEvents: options.getKnownOwnerRepoEvents?.(owner),
        fetchEvents: options.onFetchRelayEvents,
        signal,
        assertActor: options.assertActor,
      });
      const announcements = inventory.events;
      if (inventory.failedRelays.length && !config.importAnyway)
        throw new Error(
          "Some repository relays could not be checked. Review the relay results and select Import anyway to continue."
        );
      if (findSourceAnnouncements(source, owner, announcements).length && !config.importAnyway)
        throw new Error(
          "You already announced this repository. Select Import anyway to continue with a different identifier."
        );
      const assertAvailable = () =>
        assertRepoCoordinateAvailable({
          ownerPubkey: owner,
          repoName: config.forkName,
          relayUrls: checkRelays,
          onFetchRelayEvents: options.onFetchRelayEvents!,
          knownEvents: [
            ...announcements,
            ...(options.getKnownRepoEvents?.(owner, config.forkName) || []),
          ],
          allowIncomplete: config.importAnyway,
          signal,
        });
      await assertAvailable();
      signal.throwIfAborted();
      if (config.mode === "copy") {
        const result = await copy.copyRepository(
          {
            owner: source.owner,
            name: source.name,
            description: config.description ?? source.description,
            displayName: config.displayName,
            defaultBranch: source.defaultBranch,
            cloneUrls: [source.cloneUrl],
            webUrls: [source.url],
            publicSource: source,
            allowIncompleteRepoChecks: config.importAnyway,
          },
          config
        );
        complete = Boolean(result);
        error = copy.error;
        return result;
      }
      if (config.targets.length) throw new Error("Announce only cannot contain writable targets");
      const displayError = validateRepoDisplayName(config.displayName ?? source.displayName);
      if (displayError) throw new Error(displayError);
      const relays = assertRepoCreationPrerequisites({
        ownerPubkey: owner,
        repoName: config.forkName,
        targets: [],
        relayUrls: config.relays || [],
        announcementOnly: true,
        onPublishEvent: options.onPublishEvent,
        onFetchRelayEvents: options.onFetchRelayEvents,
      });
      release = reserveRepoCreation(owner, config.forkName, getPendingRepoCreationTransactions());
      await assertAvailable();
      signal.throwIfAborted();
      journal = new RepoCreationTransactionJournal({
        id: `announce:${owner}:${config.forkName}:${Date.now()}`,
        operation: "import",
        announcementOnly: true,
        ownerPubkey: owner,
        repoName: config.forkName,
        repositoryRelayUrls: relays,
        localResource: { ownedByTransaction: false, stage: "planned" },
      });
      journal.setPhase("metadata-preparing");
      const announcement = createRepoAnnouncementEvent({
        repoId: `${toNpubOrSelf(owner)}/${config.forkName}`,
        identifier: config.forkName,
        name: config.displayName ?? source.displayName,
        description: config.description ?? source.description,
        clone: [source.cloneUrl],
        web: [source.url],
        ...(config.webUrls ? { web: config.webUrls.filter((value) => value.trim()) } : {}),
        relays,
        hashtags: config.tags,
        maintainers: config.maintainers,
        community: config.community ?? undefined,
      });
      // Once delivery starts, await the exact outcome rather than racing abort and losing recovery evidence.
      const published = await trackRepoCreationPublisher(journal, options.onPublishEvent)!(
        announcement,
        {
          relays,
          stage: "final",
          assertCurrent: () => {
            signal.throwIfAborted();
            options.assertActor?.();
          },
          assertFresh: assertAvailable,
        }
      );
      const acked = new Set(extractPublishRelayAck(published).ackedRelays.map(normalizeRelayUrl));
      if (relays.some((relay) => !acked.has(normalizeRelayUrl(relay))))
        throw new Error(
          "Announcement delivery is incomplete. Resume its saved recovery instead of creating another announcement"
        );
      journal.complete();
      complete = true;
      return { announcementEvent: published.event as RepoAnnouncementEvent, remotePushResults: [] };
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      if (journal) {
        if (isSideEffectFreeAnnouncement(journal.record)) journal.complete();
        else journal.setPhase(journal.record.phase, error);
      }
      return null;
    } finally {
      announcing = false;
      release?.();
      controller = undefined;
    }
  }

  return {
    createRepository,
    abort: () => {
      controller?.abort();
      copy.abortFork("Repository copy cancelled");
    },
    get isCreating() {
      return announcing || copy.isForking;
    },
    get isComplete() {
      return complete;
    },
    get error() {
      return error;
    },
    get warning() {
      return copy.warning;
    },
    get progress() {
      return copy.progress;
    },
    get progressHistory() {
      return copy.progressHistory;
    },
    get operationActivity() {
      return copy.operationActivity;
    },
  };
}
