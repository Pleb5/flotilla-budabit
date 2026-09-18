import type { RepoAnnouncementEvent, RepoStateEvent } from "@nostr-git/core/events";
import { inspectPublicRepoSource, type PublicRepoSource } from "@nostr-git/core/git";
import { useRepoCopy, type ForkConfig, type UseForkRepoOptions } from "./useRepoCopy.svelte.js";
import { assertRepoCoordinateAvailable } from "../utils/repo-creation-preflight.js";
import { publicRepoCopyAdmissionError } from "../utils/public-repo-copy.js";
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
  /** New public imports always copy and announce. */
  mode?: "copy";
  importAnyway?: boolean;
}

export interface UsePublicRepoOptions extends UseForkRepoOptions {
  ownerRepoRelays?: string[];
  getKnownOwnerRepoEvents?: (owner: string) => NostrEvent[];
}

/** Anonymous public source -> independently controlled destinations + Nostr announcement. */
export function usePublicRepo(options: UsePublicRepoOptions = {}) {
  const copy = useRepoCopy(options);
  let preparing = $state(false);
  let error = $state<string | null>(null);
  let complete = $state(false);
  let controller: AbortController | undefined;

  async function createRepository(config: PublicRepoConfig): Promise<PublicRepoResult | null> {
    if (preparing || copy.isForking) throw new Error("Repository operation is already running");
    preparing = true;
    complete = false;
    error = null;
    controller = new AbortController();
    const signal = controller.signal;
    try {
      options.assertActor?.();
      if ((config.mode !== undefined && config.mode !== "copy") || !config.targets?.length)
        throw new Error(
          "Import requires at least one writable destination. Select a destination to copy and announce this repository."
        );
      // Recheck public identity at execution, never rely on an old metadata form or saved tokens.
      const source = await inspectPublicRepoSource(config.source.url, signal, {
        provider: config.source.provider,
      });
      options.assertActor?.();
      if (source.id !== config.source.id || source.cloneUrl !== config.source.cloneUrl)
        throw new Error("The source repository changed. Inspect it again before continuing");
      const admissionError = publicRepoCopyAdmissionError(source);
      if (admissionError) throw new Error(admissionError);
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
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      return null;
    } finally {
      preparing = false;
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
      return preparing || copy.isForking;
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
