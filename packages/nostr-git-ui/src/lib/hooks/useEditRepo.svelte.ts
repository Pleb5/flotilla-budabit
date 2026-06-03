import type { Event } from "nostr-tools";
import type { RepoAnnouncementEvent, RepoStateEvent } from "@nostr-git/core/events";
import {
  createRepoAnnouncementEvent,
  createRepoStateEvent,
  getTagValue,
} from "@nostr-git/core/events";
import { detectVendorFromUrl } from "@nostr-git/core/git";
import { isGraspRepoHttpUrl } from "@nostr-git/core/utils";
import { tokens as tokensStore } from "../stores/tokens.js";
import { normalizeGraspOrigins } from "../utils/grasp-pipeline.js";
import { getAccessTokenManagementMessage, isWorkflowScopeIssue } from "../utils/tokenManagement.js";
import { tryTokensForHost } from "../utils/tokenHelpers.js";

// Types for edit configuration and progress
interface EditConfig {
  name: string;
  description: string;
  visibility: "public" | "private";
  defaultBranch: string;
  readmeContent: string;
}

interface EditProgress {
  stage: string;
  percentage: number;
  isComplete: boolean;
}

interface EditResult {
  success: boolean;
  updatedRepo?: any;
  commitId?: string;
  error?: string;
}

interface UseEditRepoOptions {
  workerApi?: any; // Git worker API instance (optional for backward compatibility)
}

/**
 * Svelte 5 composable for managing edit repository workflow
 * Handles git-worker integration, progress tracking, and NIP-34 event emission
 */
export function useEditRepo(hookOptions: UseEditRepoOptions = {}) {
  // Reactive state using Svelte 5 runes
  let progress = $state<EditProgress | undefined>();
  let error = $state<string | undefined>();
  let isEditing = $state(false);

  const deriveGraspRelayUrl = (remoteUrl: string): string | undefined => {
    try {
      return normalizeGraspOrigins(remoteUrl).wsOrigin;
    } catch {
      return undefined;
    }
  };

  /**
   * Edit a repository with full workflow
   * 1. Update remote repository metadata via GitHub API
   * 2. Update and push files (README, etc.) to repository
   * 3. Create and emit updated NIP-34 events
   * 4. Update local store
   */
  async function editRepository(
    currentAnnouncement: RepoAnnouncementEvent,
    currentState: RepoStateEvent,
    config: EditConfig,
    editOptions: {
      repoDir: string;
      onSignEvent: (event: Partial<Event>) => Promise<Event>;
      onPublishEvent: (event: Event) => Promise<void>;
      onUpdateStore?: (repoId: string, updates: any) => Promise<void>;
    }
  ): Promise<void> {
    const { repoDir, onSignEvent, onPublishEvent, onUpdateStore } = editOptions;

    // Reset state
    error = undefined;
    isEditing = true;
    progress = {
      stage: "Initializing repository update...",
      percentage: 0,
      isComplete: false,
    };

    try {
      // Get the git worker instance using dynamic import
      let gitWorker: any;
      if (hookOptions.workerApi) {
        gitWorker = { api: hookOptions.workerApi };
      } else {
        const { getGitWorker } = await import("@nostr-git/core");
        gitWorker = await getGitWorker();
      }

      // Extract current repository info
      const repoId = getTagValue(currentAnnouncement as any, "d") || "";
      const currentName = getTagValue(currentAnnouncement as any, "name") || "";
      const cloneUrl = getTagValue(currentAnnouncement as any, "clone") || "";

      // Parse owner/repo from clone URL and extract hostname
      let owner: string, repo: string, providerHost: string;
      try {
        const url = new URL(cloneUrl);
        providerHost = url.hostname;
        const pathParts = url.pathname.split("/").filter(Boolean);
        if (pathParts.length < 2) {
          throw new Error("Invalid repository URL format");
        }
        owner = pathParts[pathParts.length - 2];
        repo = pathParts[pathParts.length - 1].replace(/\.git$/, "");
      } catch (error) {
        // Fallback to regex parsing for GitHub URLs
        const urlMatch = cloneUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
        if (!urlMatch) {
          throw new Error("Unable to parse repository owner/name from clone URL");
        }
        [, owner, repo] = urlMatch;
        providerHost = "github.com";
      }

      // Progress callback to update UI
      const onProgress = (stage: string) => {
        progress = {
          stage,
          percentage: progress?.percentage || 0,
          isComplete: false,
        };
      };

      // Step 1: Update remote repository metadata if needed
      const metadataChanged =
        config.name !== currentName ||
        config.description !== (getTagValue(currentAnnouncement as any, "description") || "") ||
        config.visibility !== (cloneUrl.includes("private") ? "private" : "public");

      if (metadataChanged) {
        progress = {
          stage: "Updating remote repository metadata...",
          percentage: 10,
          isComplete: false,
        };

        // Get tokens from store and use fallback retry
        const tokens = await tokensStore.waitForInitialization();
        const metadataResult = await tryTokensForHost(
          tokens,
          providerHost,
          async (token: string, host: string) => {
            return await gitWorker.api.updateRemoteRepoMetadata({
              owner,
              repo,
              updates: {
                name: config.name !== currentName ? config.name : undefined,
                description: config.description,
                private: config.visibility === "private",
              },
              token,
            });
          }
        );

        if (!metadataResult.success) {
          throw new Error(metadataResult.error || "Failed to update repository metadata");
        }
      }

      // Step 2: Update files if needed (README, default branch changes)
      const filesChanged =
        config.readmeContent !==
          `# ${currentName}\n\n${getTagValue(currentAnnouncement as any, "description") || ""}` ||
        config.defaultBranch !==
          (getTagValue(currentState as any, "HEAD")?.replace("ref: refs/heads/", "") || "main");

      if (filesChanged) {
        progress = {
          stage: "Updating repository files...",
          percentage: 40,
          isComplete: false,
        };

        const filesToUpdate: Array<{ path: string; content: string }> = [];

        // Add README if changed
        if (config.readmeContent) {
          filesToUpdate.push({
            path: "README.md",
            content: config.readmeContent,
          });
        }

        if (filesToUpdate.length > 0) {
          const provider = isGraspRepoHttpUrl(cloneUrl) ? "grasp" : detectVendorFromUrl(cloneUrl);

          // Get tokens from store and use fallback retry
          const tokens = await tokensStore.waitForInitialization();
          const pushResult = await tryTokensForHost(
            tokens,
            providerHost,
            async (token: string, host: string) => {
              return await gitWorker.api.updateAndPushFiles({
                dir: repoDir,
                files: filesToUpdate,
                commitMessage: `Update repository files via Nostr Git\n\n- Updated README.md\n- Updated repository metadata`,
                token,
                provider,
                onProgress,
              });
            }
          );

          if (!pushResult.success) {
            throw new Error(pushResult.error || "Failed to update repository files");
          }
        }
      }

      // Step 3: Create and emit updated NIP-34 events
      progress = {
        stage: "Creating repository announcement events...",
        percentage: 70,
        isComplete: false,
      };

      // Create updated repository announcement event
      const updatedCloneUrl =
        metadataChanged && config.name !== currentName
          ? cloneUrl.replace(`/${repo}.git`, `/${config.name}.git`)
          : cloneUrl;

      const isGraspRepo = isGraspRepoHttpUrl(updatedCloneUrl);
      const cloneUrls = [updatedCloneUrl];
      const relayUrl = isGraspRepo ? deriveGraspRelayUrl(updatedCloneUrl) : undefined;
      const relayUrls = relayUrl ? [relayUrl] : [];

      const announcementEvent = createRepoAnnouncementEvent({
        repoId: repoId,
        name: config.name,
        description: config.description,
        clone: cloneUrls,
        relays: relayUrls.length > 0 ? relayUrls : undefined,
        created_at: Math.floor(Date.now() / 1000),
      });

      // Create updated repository state event
      const stateEvent = createRepoStateEvent({
        repoId: repoId,
        head: config.defaultBranch,
        created_at: Math.floor(Date.now() / 1000),
      });

      progress = {
        stage: "Publishing repository events...",
        percentage: 85,
        isComplete: false,
      };

      // Sign and publish the announcement event
      const signedAnnouncement = await onSignEvent(announcementEvent);
      await onPublishEvent(signedAnnouncement);

      // Sign and publish the state event
      const signedState = await onSignEvent(stateEvent);
      await onPublishEvent(signedState);

      // Step 4: Update local store
      if (onUpdateStore) {
        progress = {
          stage: "Updating local repository store...",
          percentage: 95,
          isComplete: false,
        };

        await onUpdateStore(repoId, {
          name: config.name,
          description: config.description,
          visibility: config.visibility,
          defaultBranch: config.defaultBranch,
          cloneUrl: updatedCloneUrl,
        });
      }

      // Mark as complete
      progress = {
        stage: "Repository updated successfully!",
        percentage: 100,
        isComplete: true,
      };
    } catch (err: any) {
      console.error("Edit repository failed:", err);
      const message = err?.message || "Repository update failed";
      if (isWorkflowScopeIssue(message)) {
        error = getAccessTokenManagementMessage(message);
      } else {
        error = message;
      }

      // Reset progress on error
      progress = undefined;
    } finally {
      isEditing = false;
    }
  }

  /**
   * Reset the edit state
   * Useful for retrying after errors or starting fresh
   */
  function reset(): void {
    progress = undefined;
    error = undefined;
    isEditing = false;
  }

  // Return reactive state and methods
  return {
    // Reactive state (automatically reactive in Svelte 5)
    get progress() {
      return progress;
    },
    get error() {
      return error;
    },
    get isEditing() {
      return isEditing;
    },

    // Methods
    editRepository,
    reset,
  };
}
