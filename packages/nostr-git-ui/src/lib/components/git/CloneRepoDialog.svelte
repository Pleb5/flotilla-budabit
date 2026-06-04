<script lang="ts">
  import { useRegistry } from "../../useRegistry";
  const { Button } = useRegistry();
  import type { NostrEvent } from "nostr-tools";

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSignEvent: (evt: NostrEvent) => Promise<NostrEvent>;
    onPublishEvent: (signed: NostrEvent) => Promise<void>;
    onCloneComplete?: (repoPath: string) => void;
  }

  interface CloneProgress {
    stage: string;
    percentage: number;
    isComplete: boolean;
    error?: string;
  }

  const { isOpen, onClose, onSignEvent, onPublishEvent, onCloneComplete }: Props = $props();

  // Form state
  let repoUrl = $state("");
  let destinationPath = $state("");
  let cloneDepth = $state<"full" | "shallow">("shallow");

  // UI state
  let isCloning = $state(false);
  let progress = $state<CloneProgress>({
    stage: "",
    percentage: 0,
    isComplete: false,
  });
  let validationError = $state<string | undefined>();

  // Auto-generate destination path from URL
  $effect(() => {
    if (repoUrl && !isCloning) {
      try {
        const url = new URL(repoUrl);
        const pathParts = url.pathname.split("/").filter(Boolean);
        if (pathParts.length >= 2) {
          const repoName = pathParts[pathParts.length - 1].replace(/\.git$/, "");
          destinationPath = repoName;
        }
      } catch {
        // Invalid URL, don't update destination
      }
    }
  });

  function validateUrl(url: string): string | undefined {
    if (!url.trim()) {
      return "Repository URL is required";
    }

    try {
      const parsedUrl = new URL(url);

      // Check for supported protocols
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return "Only HTTP and HTTPS URLs are supported";
      }

      // Check for common Git hosting patterns
      const hostname = parsedUrl.hostname.toLowerCase();
      const supportedHosts = ["github.com", "gitlab.com", "bitbucket.org"];
      const isKnownHost = supportedHosts.some(
        (host) => hostname === host || hostname.endsWith("." + host)
      );

      if (!isKnownHost && !parsedUrl.pathname.endsWith(".git")) {
        return "URL should end with .git or be from a known Git hosting service";
      }

      return undefined;
    } catch {
      return "Invalid URL format";
    }
  }

  function validateDestination(path: string): string | undefined {
    if (!path.trim()) {
      return "Destination path is required";
    }

    // Check for invalid characters
    const invalidChars = /[<>:"|?*]/;
    if (invalidChars.test(path)) {
      return "Destination path contains invalid characters";
    }

    return undefined;
  }

  async function handleClone() {
    // Validate inputs
    const urlError = validateUrl(repoUrl);
    const pathError = validateDestination(destinationPath);

    if (urlError || pathError) {
      validationError = urlError || pathError;
      return;
    }

    validationError = undefined;
    isCloning = true;
    progress = {
      stage: "Initializing clone...",
      percentage: 0,
      isComplete: false,
    };

    try {
      // Import the clone hook dynamically to avoid circular dependencies
      const { useCloneRepo } = await import("../../hooks/useCloneRepo.svelte");

      const cloneHook = useCloneRepo({
        onProgress: (stage: string, pct: number = 0) => {
          progress = {
            stage,
            percentage: Math.min(100, Math.max(0, pct)),
            isComplete: false,
          };
        },
        onSignEvent,
        onPublishEvent,
      });

      const depth = cloneDepth === "shallow" ? 1 : undefined;
      await cloneHook.cloneRepository(repoUrl, destinationPath, depth);

      progress = {
        stage: "Clone completed successfully!",
        percentage: 100,
        isComplete: true,
      };

      // Notify parent component
      onCloneComplete?.(destinationPath);

      // Auto-close after a brief delay
      setTimeout(() => {
        onClose();
        resetForm();
      }, 2000);
    } catch (error) {
      progress = {
        stage: "Clone failed",
        percentage: 0,
        isComplete: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      isCloning = false;
    }
  }

  function resetForm() {
    repoUrl = "";
    destinationPath = "";
    cloneDepth = "shallow";
    progress = {
      stage: "",
      percentage: 0,
      isComplete: false,
    };
    validationError = undefined;
  }

  function handleCancel() {
    if (!isCloning) {
      onClose();
      resetForm();
    }
  }

  function handleUrlInput(event: Event) {
    const target = event.target as HTMLInputElement;
    repoUrl = target.value;
    validationError = undefined;
  }

  function handleDestinationInput(event: Event) {
    const target = event.target as HTMLInputElement;
    destinationPath = target.value;
    validationError = undefined;
  }

  function handleDepthChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    cloneDepth = target.value as "full" | "shallow";
  }
</script>

{#if isOpen}
  <!-- Modal Backdrop -->
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <!-- Modal Content -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-lg w-full max-w-md mx-4">
      <!-- Header -->
      <div class="flex items-center justify-between p-6 border-b border-border">
        <h2 class="text-lg font-semibold text-gray-100">Clone Repository</h2>
        {#if !isCloning}
          <button
            onclick={handleCancel}
            class="text-gray-400 hover:text-gray-200 transition-colors"
            aria-label="Close dialog"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              ></path>
            </svg>
          </button>
        {/if}
      </div>

      <!-- Content -->
      <div class="p-6 space-y-4">
        {#if !isCloning}
          <!-- Repository URL Input -->
          <div>
            <label for="repo-url" class="block text-sm font-medium text-gray-300 mb-2">
              Repository URL or Naddr *
            </label>
            <input
              id="repo-url"
              type="url"
              value={repoUrl}
              oninput={handleUrlInput}
              placeholder="https://github.com/user/repo.git"
              class="w-full px-3 py-2 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-700 text-gray-100"
              class:border-red-500={validationError}
              disabled={isCloning}
            />
          </div>

          <!-- Destination Path Input -->
          <div>
            <label for="destination" class="block text-sm font-medium text-gray-300 mb-2">
              Destination Path *
            </label>
            <input
              id="destination"
              type="text"
              value={destinationPath}
              oninput={handleDestinationInput}
              placeholder="my-repo"
              class="w-full px-3 py-2 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-700 text-gray-100"
              class:border-red-500={validationError}
              disabled={isCloning}
            />
            <p class="mt-1 text-sm text-gray-400">Local directory name for the cloned repository</p>
          </div>

          <!-- Clone Depth Selector -->
          <div>
            <label for="clone-depth" class="block text-sm font-medium text-gray-300 mb-2">
              Clone Depth
            </label>
            <select
              id="clone-depth"
              value={cloneDepth}
              onchange={handleDepthChange}
              class="w-full px-3 py-2 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-700 text-gray-100"
              disabled={isCloning}
            >
              <option value="shallow">Shallow (1 commit) - Faster</option>
              <option value="full">Full - Complete history</option>
            </select>
            <p class="mt-1 text-sm text-gray-400">
              Shallow clones are faster but contain limited history
            </p>
          </div>

          <!-- Validation Error -->
          {#if validationError}
            <div class="p-3 bg-red-900/20 border border-red-500 rounded-md">
              <p class="text-sm text-red-400">{validationError}</p>
            </div>
          {/if}
        {:else}
          <!-- Clone Progress -->
          <div class="space-y-4">
            <div class="text-center">
              <div class="text-sm font-medium text-gray-100 mb-2">
                {progress.stage}
              </div>

              <!-- Progress Bar -->
              <div class="w-full bg-gray-700 rounded-full h-2 mb-2">
                <div
                  class="h-2 rounded-full transition-all duration-300 ease-in-out"
                  class:bg-blue-600={!progress.isComplete && !progress.error}
                  class:bg-green-600={progress.isComplete}
                  class:bg-red-600={progress.error}
                  style="width: {progress.percentage}%"
                ></div>
              </div>

              <div class="text-xs text-gray-400">
                {Math.round(progress.percentage)}% complete
              </div>
            </div>

            <!-- Error Display -->
            {#if progress.error}
              <div class="p-3 bg-red-900/20 border border-red-500 rounded-md">
                <p class="text-sm text-red-400 mb-2">
                  <strong>Error:</strong>
                  {progress.error}
                </p>
                <Button onclick={handleClone} variant="outline" size="sm" class="w-full">
                  Retry Clone
                </Button>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Footer -->
      {#if !isCloning}
        <div class="flex justify-end space-x-3 p-6 border-t border-border">
          <Button onclick={handleCancel} variant="outline" size="sm">Cancel</Button>

          <Button
            onclick={handleClone}
            size="sm"
            disabled={!repoUrl.trim() || !destinationPath.trim()}
          >
            Clone Repository
          </Button>
        </div>
      {/if}
    </div>
  </div>
{/if}
