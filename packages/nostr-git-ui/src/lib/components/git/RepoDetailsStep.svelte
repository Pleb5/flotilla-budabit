<script lang="ts">
  import { tokens as tokensStore, type Token } from "../../stores/tokens.js";

  interface Props {
    repoName: string;
    description: string;
    initializeWithReadme: boolean;
    defaultBranch: string;
    gitignoreTemplate: string;
    licenseTemplate: string;
    onRepoNameChange: (name: string) => void;
    onDescriptionChange: (description: string) => void;
    onReadmeChange: (initialize: boolean) => void;
    onDefaultBranchChange: (branch: string) => void;
    onGitignoreChange: (template: string) => void;
    onLicenseChange: (template: string) => void;
    validationErrors?: {
      name?: string;
      description?: string;
    };
    nameAvailabilityResults?: {
      results: Array<{
        provider: string;
        host: string;
        available: boolean;
        reason?: string;
        username?: string;
        error?: string;
      }>;
      hasConflicts: boolean;
      availableProviders: string[];
      conflictProviders: string[];
    } | null;
    isCheckingAvailability?: boolean;
  }

  const {
    repoName,
    description,
    initializeWithReadme,
    defaultBranch,
    gitignoreTemplate,
    licenseTemplate,
    onRepoNameChange,
    onDescriptionChange,
    onReadmeChange,
    onDefaultBranchChange,
    onGitignoreChange,
    onLicenseChange,
    validationErrors = {},
    nameAvailabilityResults = null,
    isCheckingAvailability = false,
  }: Props = $props();

  // State for real-time repository name validation
  let tokens = $state<Token[]>([]);

  // Subscribe to token store
  tokensStore.subscribe((t) => {
    tokens = t;
  });

  const gitignoreOptions = [
    { value: "", label: "None" },
    { value: "node", label: "Node.js" },
    { value: "python", label: "Python" },
    { value: "web", label: "Web Development" },
    { value: "svelte", label: "Svelte" },
    { value: "java", label: "Java" },
    { value: "android", label: "Android" },
    { value: "ios", label: "iOS (Swift/Objective-C)" },
    { value: "flutter", label: "Flutter/Dart" },
    { value: "cpp", label: "C/C++" },
    { value: "go", label: "Go" },
  ];

  const licenseOptions = [
    { value: "", label: "None" },
    { value: "mit", label: "MIT License" },
    { value: "apache-2.0", label: "Apache License 2.0" },
  ];

  function handleGitignoreChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    onGitignoreChange(target.value);
  }

  function handleLicenseChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    onLicenseChange(target.value);
  }

  function handleBranchInput(event: Event) {
    const target = event.target as HTMLInputElement;
    onDefaultBranchChange(target.value);
  }

  function validateRepoName(name: string): string | undefined {
    if (!name.trim()) {
      return "Repository name is required";
    }
    if (name.length < 3) {
      return "Repository name must be at least 3 characters";
    }
    if (name.length > 100) {
      return "Repository name must be 100 characters or less";
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      return "Repository name can only contain letters, numbers, dots, hyphens, and underscores";
    }
    return undefined;
  }

  function validateDescription(desc: string): string | undefined {
    if (desc.length > 350) {
      return "Description must be 350 characters or less";
    }
    return undefined;
  }

  function handleNameInput(event: Event) {
    const target = event.target as HTMLInputElement;
    onRepoNameChange(target.value);
  }

  function handleNameBlur(event: Event) {
    const target = event.target as HTMLInputElement;
    // Availability check is now handled by parent component
  }

  function handleDescriptionInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    onDescriptionChange(target.value);
  }

  function handleReadmeChange(event: Event) {
    const target = event.target as HTMLInputElement;
    onReadmeChange(target.checked);
  }

  function formatAvailabilityUsername(username: string): string {
    if (!username) return "";
    if (username.startsWith("npub1") && username.length > 24) {
      return `${username.slice(0, 12)}...${username.slice(-8)}`;
    }
    return username;
  }
</script>

<div class="space-y-6">
  <div class="space-y-4">
    <h2 class="text-xl font-semibold text-gray-100">Repository Details</h2>
    <p class="text-sm text-gray-300">Set up the basic information for your new repository.</p>
  </div>

  <div class="space-y-4">
    <!-- Repository Name -->
    <div>
      <label for="repo-name" class="block text-sm font-medium text-gray-300 mb-2">
        Repository name *
      </label>
      <div class="relative">
        <input
          id="repo-name"
          type="text"
          value={repoName}
          oninput={handleNameInput}
          onblur={handleNameBlur}
          placeholder="my-awesome-project"
          class="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
          class:border-red-500={validationErrors.name}
          class:border-green-500={nameAvailabilityResults &&
            nameAvailabilityResults.availableProviders.length > 0}
          class:focus:ring-red-500={validationErrors.name}
          class:focus:ring-green-500={nameAvailabilityResults &&
            nameAvailabilityResults.availableProviders.length > 0}
          class:focus:border-red-500={validationErrors.name}
          class:focus:border-green-500={nameAvailabilityResults &&
            nameAvailabilityResults.availableProviders.length > 0}
        />

        <!-- Loading/Status Indicator -->
        <div class="absolute inset-y-0 right-0 flex items-center pr-3">
          {#if isCheckingAvailability}
            <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
          {/if}
        </div>
      </div>

      <!-- Error Messages -->
      {#if validationErrors.name}
        <p class="mt-1 text-sm text-red-400">
          {validationErrors.name}
        </p>
      {/if}

      <!-- Repository Name Availability Status -->
      {#if repoName.trim() && tokens.length > 0}
        <div
          class="mt-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
        >
          <h4 class="text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Repository Name Availability
          </h4>

          {#if isCheckingAvailability}
            <div class="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
              <div
                class="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"
              ></div>
              <span>Checking availability on selected provider...</span>
            </div>
          {:else if nameAvailabilityResults}
            <div class="space-y-2">
              {#each nameAvailabilityResults.results as result}
                <div class="flex items-center justify-between text-sm">
                  <div class="flex items-center space-x-2 min-w-0">
                    <span class="font-medium capitalize shrink-0">{result.provider}</span>
                    {#if result.username}
                      <span
                        class="text-gray-500 dark:text-gray-400 min-w-0 truncate"
                        title={result.username}
                        >({formatAvailabilityUsername(result.username)})</span
                      >
                    {/if}
                  </div>
                  <div class="flex items-center space-x-1 shrink-0">
                    {#if result.error}
                      <span class="text-yellow-600 dark:text-yellow-400" title={result.error}
                        >⚠ Check failed</span
                      >
                    {:else if result.available}
                      <span class="text-green-600 dark:text-green-400">✓ Available</span>
                    {:else}
                      <span class="text-red-600 dark:text-red-400">✗ Taken</span>
                    {/if}
                  </div>
                </div>
              {/each}

              {#if nameAvailabilityResults.hasConflicts}
                <div
                  class="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-400"
                >
                  <strong>Warning:</strong> This repository name is already taken on the selected
                  provider{#if nameAvailabilityResults.conflictProviders[0]}
                    ({nameAvailabilityResults.conflictProviders[0]}){/if}.
                </div>
              {:else if nameAvailabilityResults.results.some((r) => r.error)}
                {@const errorResult = nameAvailabilityResults.results.find((r) => r.error)}
                <div
                  class="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-yellow-700 dark:text-yellow-400"
                >
                  <strong>Unable to verify:</strong> Could not check name availability ({errorResult?.error ||
                    "Authentication failed"}). You may proceed, but please verify the name is not
                  already taken.
                </div>
              {:else if nameAvailabilityResults.availableProviders.length > 0}
                <div
                  class="mt-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-sm text-green-700 dark:text-green-400"
                >
                  <strong>Good news!</strong> Repository name is available on the selected provider{#if nameAvailabilityResults.availableProviders[0]}
                    ({nameAvailabilityResults.availableProviders[0]}){/if}.
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Description -->
    <div>
      <label for="repo-description" class="block text-sm font-medium text-gray-300 mb-2">
        Description (optional)
      </label>
      <textarea
        id="repo-description"
        value={description}
        oninput={handleDescriptionInput}
        placeholder="A brief description of your repository"
        rows="3"
        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100 resize-vertical"
        class:border-red-500={validationErrors.description}
        class:focus:ring-red-500={validationErrors.description}
        class:focus:border-red-500={validationErrors.description}
      ></textarea>
      <div class="mt-1 flex justify-between items-center">
        {#if validationErrors.description}
          <p class="text-sm text-red-400">
            {validationErrors.description}
          </p>
        {:else}
          <p class="text-sm text-gray-400">
            {description.length}/350 characters
          </p>
        {/if}
      </div>
    </div>

    <!-- Initialize with README -->
    <div class="border-t border-gray-200 dark:border-gray-700 pt-4">
      <div class="space-y-3">
        <h3 class="text-sm font-medium text-gray-300">Initialize repository</h3>
        <label class="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={initializeWithReadme}
            onchange={handleReadmeChange}
            class="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <div>
            <div class="text-sm font-medium text-gray-100">Add a README file</div>
            <div class="text-sm text-gray-400">
              This is where you can write a long description for your project
            </div>
          </div>
        </label>

        <div class="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
          <div class="space-y-4">
            <div>
              <label for="default-branch" class="block text-sm font-medium text-gray-300 mb-2">
                Default branch name
              </label>
              <input
                id="default-branch"
                type="text"
                value={defaultBranch}
                oninput={handleBranchInput}
                placeholder="master"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>

            <!-- .gitignore Template -->
            <div>
              <label for="gitignore-template" class="block text-sm font-medium text-gray-300 mb-2">
                .gitignore template
              </label>
              <select
                id="gitignore-template"
                value={gitignoreTemplate}
                onchange={handleGitignoreChange}
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              >
                {#each gitignoreOptions as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </div>

            <!-- License Template -->
            <div>
              <label for="license-template" class="block text-sm font-medium text-gray-300 mb-2">
                License
              </label>
              <select
                id="license-template"
                value={licenseTemplate}
                onchange={handleLicenseChange}
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              >
                {#each licenseOptions as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
