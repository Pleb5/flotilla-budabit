import type { NostrEvent } from "nostr-tools";
import type { RepoStateTag } from "@nostr-git/core/events";
import { GIT_REPO_STATE } from "@nostr-git/core/events";
import { tokens as tokensStore } from "../stores/tokens.js";
import { tryTokensForHost, getTokensForHost } from "../utils/tokenHelpers.js";

// Note: This import will need to be updated based on the actual git-worker export location
// For now, we'll use a dynamic import in the function

interface CloneRepoOptions {
  workerApi?: any; // Git worker API instance (optional for backward compatibility)
  onProgress?: (stage: string, percentage?: number) => void;
  onSignEvent: (evt: NostrEvent) => Promise<NostrEvent>;
  onPublishEvent: (signed: NostrEvent) => Promise<void>;
}

interface CloneRepoHook {
  cloneRepository: (url: string, destinationPath: string, depth?: number) => Promise<void>;
  isCloning: boolean;
  error: string | null;
}

/**
 * Svelte hook for cloning repositories with progress tracking and event emission
 * Handles the complete clone workflow including NIP-34 event publishing
 */
export function useCloneRepo(options: CloneRepoOptions): CloneRepoHook {
  const { onProgress, onSignEvent, onPublishEvent } = options;

  let isCloning = $state(false);
  let error = $state<string | null>(null);

  /**
   * Clone a repository from a remote URL
   */
  async function cloneRepository(
    url: string,
    destinationPath: string,
    depth?: number
  ): Promise<void> {
    if (isCloning) {
      throw new Error("Clone operation already in progress");
    }

    isCloning = true;
    error = null;

    try {
      onProgress?.("Initializing clone operation...", 0);

      // Get the git worker instance using dynamic import
      // This avoids circular dependency issues
      let api: any;
      if (options.workerApi) {
        api = options.workerApi;
      } else {
        const { getGitWorker } = await import("@nostr-git/core");
        const workerInstance = await getGitWorker();
        api = workerInstance.api;
      }

      // Validate inputs
      if (!url.trim()) {
        throw new Error("Repository URL is required");
      }

      if (!destinationPath.trim()) {
        throw new Error("Destination path is required");
      }

      // Sanitize destination path
      const sanitizedPath = destinationPath.trim().replace(/[<>:"|?*]/g, "");
      if (!sanitizedPath) {
        throw new Error("Invalid destination path");
      }

      onProgress?.("Preparing to clone repository...", 5);

      // Extract hostname from URL for token matching
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Wait for tokens to be initialized
      const tokens = await tokensStore.waitForInitialization();
      const matchingTokens = getTokensForHost(tokens, hostname);

      onProgress?.("Starting clone operation...", 10);

      // Perform the clone operation with token retry logic if tokens are available
      // For public repos, allow cloning without tokens
      let result;
      if (matchingTokens.length > 0) {
        // Try all tokens for this host until one succeeds
        result = await tryTokensForHost(
          tokens,
          hostname,
          async (token: string, host: string) => {
            return await api.cloneRemoteRepo({
              url,
              dir: sanitizedPath,
              depth,
              token,
              onProgress: (stage: string, pct?: number) => {
                onProgress?.(stage, pct);
              },
            });
          }
        );
      } else {
        // No tokens available - try cloning without authentication (public repos)
        result = await api.cloneRemoteRepo({
          url,
          dir: sanitizedPath,
          depth,
          onProgress: (stage: string, pct?: number) => {
            onProgress?.(stage, pct);
          },
        });
      }

      onProgress?.("Clone completed, creating repository announcement...", 95);

      // Create and emit NIP-34 repository state event
      await createAndEmitRepoStateEvent(url, sanitizedPath, api);

      onProgress?.("Repository cloned successfully!", 100);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      error = errorMessage;
      onProgress?.(`Clone failed: ${errorMessage}`, 0);
      throw err;
    } finally {
      isCloning = false;
    }
  }

  /**
   * Create and emit a NIP-34 repository state event after successful clone
   */
  async function createAndEmitRepoStateEvent(repoUrl: string, localPath: string, workerApi: any): Promise<void> {
    try {
      // Extract repository information from URL
      const url = new URL(repoUrl);
      const pathParts = url.pathname.split("/").filter(Boolean);

      if (pathParts.length < 2) {
        throw new Error("Invalid repository URL format");
      }

      const owner = pathParts[pathParts.length - 2];
      const repoName = pathParts[pathParts.length - 1].replace(/\.git$/, "");
      const repoSlug = `${owner}/${repoName}`;

      // Get the actual default branch from the cloned repository
      let defaultBranch: string | undefined;

      try {
        // Query the worker for the repository's branches to determine the default
        const branches = await workerApi.listBranches({ repoId: repoSlug });
        if (branches && branches.length > 0) {
          // Use the first branch (usually the default/HEAD branch)
          defaultBranch = branches[0];
        }
      } catch (error) {
        console.warn("Could not determine default branch from repo:", error);
      }

      // If we couldn't determine the branch, we can't create a valid repo state event
      if (!defaultBranch) {
        console.warn("Could not determine default branch - skipping repo state event creation");
        return;
      }

      // Create NIP-34 repository state event using proper types
      const repoStateTags: RepoStateTag[] = [
        ["d", repoSlug], // Repository identifier
        [`refs/heads/${defaultBranch}`, ""], // Default branch ref
        ["HEAD", `ref: refs/heads/${defaultBranch}`], // HEAD reference
      ];

      const repoStateEvent: Partial<NostrEvent> = {
        kind: GIT_REPO_STATE,
        content: JSON.stringify({
          name: repoName,
          description: `Cloned repository: ${repoSlug}`,
          clone_url: repoUrl,
          web_url: repoUrl.replace(/\.git$/, ""),
          default_branch: defaultBranch,
        }),
        tags: repoStateTags,
        created_at: Math.floor(Date.now() / 1000),
      };

      // Sign the event using the injected signing function
      const signedEvent = await onSignEvent(repoStateEvent as NostrEvent);

      // Publish the signed event using the injected publishing function
      await onPublishEvent(signedEvent);

      console.log("Repository state event published successfully");
    } catch (error) {
      console.warn("Failed to create/emit repository state event:", error);
      // Don't throw here - the clone was successful even if event emission failed
    }
  }

  return {
    cloneRepository,
    isCloning,
    error,
  };
}

/**
 * Helper function to parse repository URLs and extract metadata
 */
export function parseRepositoryUrl(url: string): {
  hostname: string;
  owner: string;
  name: string;
  slug: string;
  isValid: boolean;
} {
  try {
    const parsedUrl = new URL(url);
    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);

    if (pathParts.length < 2) {
      return {
        hostname: "",
        owner: "",
        name: "",
        slug: "",
        isValid: false,
      };
    }

    const owner = pathParts[pathParts.length - 2];
    const name = pathParts[pathParts.length - 1].replace(/\.git$/, "");
    const slug = `${owner}/${name}`;

    return {
      hostname: parsedUrl.hostname,
      owner,
      name,
      slug,
      isValid: true,
    };
  } catch {
    return {
      hostname: "",
      owner: "",
      name: "",
      slug: "",
      isValid: false,
    };
  }
}

/**
 * Helper function to validate repository URLs
 */
export function validateRepositoryUrl(url: string): {
  isValid: boolean;
  error?: string;
} {
  if (!url.trim()) {
    return { isValid: false, error: "URL is required" };
  }

  try {
    const parsedUrl = new URL(url);

    // Check protocol
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return { isValid: false, error: "Only HTTP and HTTPS URLs are supported" };
    }

    // Check path structure
    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) {
      return { isValid: false, error: "URL must contain owner and repository name" };
    }

    // Check for common Git hosting patterns
    const hostname = parsedUrl.hostname.toLowerCase();
    const supportedHosts = ["github.com", "gitlab.com", "bitbucket.org"];
    const isKnownHost = supportedHosts.some(
      (host) => hostname === host || hostname.endsWith("." + host)
    );

    if (!isKnownHost && !parsedUrl.pathname.endsWith(".git")) {
      return {
        isValid: false,
        error: "URL should end with .git or be from a known Git hosting service",
      };
    }

    return { isValid: true };
  } catch {
    return { isValid: false, error: "Invalid URL format" };
  }
}
