<script lang="ts">
  import RepoRelayCheckStatus from "./RepoRelayCheckStatus.svelte";
  import type { RepoRelayCheckReport } from "../../utils/repo-creation-preflight.js";
  import {
    mergeRepoRelayChecks,
    type ExistingSourceAnnouncement,
  } from "../../utils/repo-import-checks.js";
  interface Props {
    importing?: boolean;
    repoName: string;
    displayName: string;
    ownerPubkey?: string;
    onDisplayNameChange: (name: string) => void;
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
      displayName?: string;
      description?: string;
    };
    nameAvailabilityResults?: {
      results: Array<{
        provider: string;
        host: string;
        available: boolean;
        reason?: string;
        username?: string;
        cloneUrl?: string;
        existsAlready?: boolean;
        error?: string;
      }>;
      hasConflicts: boolean;
      availableProviders: string[];
      conflictProviders: string[];
    } | null;
    isCheckingAvailability?: boolean;
    coordinateAvailability?: { name: string; available: boolean; error?: string } | null;
    onCheckAvailability?: () => void;
    coordinateChecks?: RepoRelayCheckReport | null;
    sourceRelayChecks?: RepoRelayCheckReport | null;
    sourceDuplicates?: ExistingSourceAnnouncement[];
    importAnyway?: boolean;
    onImportAnyway?: (value: boolean) => void;
  }

  const {
    importing = false,
    repoName,
    displayName,
    ownerPubkey,
    onDisplayNameChange,
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
    coordinateAvailability = null,
    onCheckAvailability,
    coordinateChecks = null,
    sourceRelayChecks = null,
    sourceDuplicates = [],
    importAnyway = false,
    onImportAnyway,
  }: Props = $props();
  const relayChecks = $derived(mergeRepoRelayChecks([coordinateChecks, sourceRelayChecks]));

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
    <h2 class="text-xl font-semibold text-foreground">Repository Details</h2>
    <p class="text-sm text-muted-foreground">
      {importing
        ? "Review the source metadata and choose the identifier for your new copies and Nostr announcement."
        : "Set up the basic information for your new repository."}
    </p>
  </div>

  <div class="space-y-4">
    <!-- Repository Name -->
    <div>
      <label for="repo-display-name" class="mb-2 block text-sm font-medium text-foreground"
        >Display name *</label
      >
      <input
        id="repo-display-name"
        value={displayName}
        oninput={(event) => onDisplayNameChange(event.currentTarget.value)}
        placeholder="My Great Repo!"
        maxlength="100"
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <p class="mt-1 text-sm text-muted-foreground">
        Spaces and Unicode are welcome. This name can be changed later.
      </p>
      {#if validationErrors.displayName}<p class="mt-1 text-sm text-red-400">
          {validationErrors.displayName}
        </p>{/if}
    </div>
    <div>
      <label for="repo-name" class="mb-2 block text-sm font-medium text-foreground">
        Repository identifier *
      </label>
      <div class="relative">
        <input
          id="repo-name"
          type="text"
          value={repoName}
          oninput={handleNameInput}
          onblur={handleNameBlur}
          placeholder="my-awesome-project"
          class="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
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

      <p class="mt-1 text-sm text-muted-foreground">
        Fixed after creation; used in repository addresses and Git paths. Edit the suggestion to
        choose a different identifier.
      </p>
      {#if ownerPubkey && repoName}
        <p class="mt-2 break-all text-xs text-muted-foreground" aria-label="Repository coordinate">
          30617:{ownerPubkey}:{repoName}
        </p>
      {/if}
      {#if coordinateAvailability?.name === repoName}
        {#if coordinateAvailability.available}
          <p
            role="status"
            class="mt-2 font-semibold {coordinateChecks?.failedRelays.length
              ? ''
              : 'text-green-700 dark:text-green-300'}"
          >
            {coordinateChecks?.failedRelays.length
              ? "No identifier clash found in the results received"
              : "✓ Nostr repository identifier available"}
          </p>
        {:else}
          <p role="alert" class="mt-2 font-medium text-destructive">
            {coordinateAvailability.error}
          </p>
          {#if onCheckAvailability}<button
              type="button"
              class="mt-2 rounded border border-input px-3 py-2 text-sm"
              onclick={onCheckAvailability}>Check identifier again</button
            >{/if}
        {/if}
      {/if}
      {#if coordinateChecks || sourceRelayChecks}
        <div class="mt-3 space-y-3 rounded border border-border p-3">
          <h4 class="text-sm font-semibold">Nostr announcement and identifier checks</h4>
          <RepoRelayCheckStatus report={relayChecks} />
          {#if importing && sourceRelayChecks}
            {#if sourceDuplicates.length}
              <p role="alert" class="font-semibold">
                You already announced this source repository.
              </p>
              <ul class="space-y-1 text-sm">
                {#each sourceDuplicates as duplicate}<li>
                    {duplicate.name} <span class="font-mono">({duplicate.identifier})</span>
                  </li>{/each}
              </ul>
            {:else}<p class="text-sm">
                No matching source clone URL found in your cached announcements or the relay results
                received.
              </p>{/if}
          {/if}
          {#if relayChecks.failedRelays.length}
            <button
              type="button"
              class="rounded border border-input px-3 py-2 text-sm"
              onclick={onCheckAvailability}>Retry relay checks</button
            >
          {/if}
          {#if importing && (sourceDuplicates.length || relayChecks.failedRelays.length)}
            <p class="text-sm">
              Import an independent copy despite these announcement checks. Confirmed identifier
              clashes and occupied destinations still require a different name.
            </p>
            <label class="flex cursor-pointer items-center gap-3 font-semibold"
              ><input
                type="checkbox"
                class="h-4 w-4 rounded-sm"
                checked={importAnyway}
                onchange={(event) => onImportAnyway?.(event.currentTarget.checked)}
              /> Import anyway</label
            >
          {/if}
        </div>
      {/if}

      <!-- These are bounded destination checks, not global name reservation. -->
      {#if repoName.trim() && (isCheckingAvailability || nameAvailabilityResults)}
        <div class="mt-2 rounded-lg border border-border bg-muted/30 p-3">
          <h4 class="mb-2 text-sm font-medium text-foreground">
            Destination identifier availability
          </h4>

          {#if isCheckingAvailability}
            <div class="flex items-center space-x-2 text-sm text-muted-foreground">
              <div
                class="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"
              ></div>
              <span>Checking selected destinations and your Nostr announcements…</span>
            </div>
          {:else if nameAvailabilityResults}
            <div class="space-y-2">
              {#each nameAvailabilityResults.results as result}
                <div class="space-y-1 border-b border-border pb-2 text-sm last:border-0">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex items-center space-x-2 min-w-0">
                      <span class="font-medium capitalize shrink-0">{result.provider}</span>
                      {#if result.username}
                        <span class="min-w-0 truncate text-muted-foreground" title={result.username}
                          >({formatAvailabilityUsername(result.username)})</span
                        >
                      {/if}
                    </div>
                    <div class="flex items-center space-x-1 shrink-0">
                      {#if result.existsAlready}
                        <span class="text-red-600 dark:text-red-400">✗ Taken</span>
                      {:else if result.error}
                        <span class="text-yellow-600 dark:text-yellow-400" title={result.error}
                          >⚠ Could not verify</span
                        >
                      {:else if result.available}
                        <span class="text-green-600 dark:text-green-400">✓ Available</span>
                      {:else}
                        <span class="text-red-600 dark:text-red-400">✗ Taken</span>
                      {/if}
                    </div>
                  </div>
                  <p class="break-all font-medium">
                    {result.host}{#if result.username}
                      — account: {result.username}{/if}
                  </p>
                  {#if result.cloneUrl}<p class="break-all font-mono text-xs">
                      {result.cloneUrl}
                    </p>{/if}
                  {#if result.reason}<p class="break-words text-xs">{result.reason}</p>{/if}
                </div>
              {/each}

              {#if nameAvailabilityResults.hasConflicts}
                <div
                  class="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-400"
                >
                  <strong>Already exists:</strong> This identifier is taken on the selected provider{#if nameAvailabilityResults.conflictProviders[0]}
                    ({nameAvailabilityResults.conflictProviders[0]}){/if}.
                </div>
              {:else if nameAvailabilityResults.results.some((r) => r.error)}
                {@const errorResult = nameAvailabilityResults.results.find((r) => r.error)}
                <div
                  class="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-yellow-700 dark:text-yellow-400"
                >
                  <strong>Unable to verify:</strong> Could not check identifier availability ({errorResult?.error ||
                    "Authentication failed"}). Retry the check before creating the repository.
                </div>
              {:else if nameAvailabilityResults.availableProviders.length > 0}
                <div
                  class="mt-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-sm text-green-700 dark:text-green-400"
                >
                  <strong>Available on checked destinations.</strong> The identifier was not found
                  on the selected provider{#if nameAvailabilityResults.availableProviders[0]}
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
      <label for="repo-description" class="mb-2 block text-sm font-medium text-foreground">
        Description (optional)
      </label>
      <textarea
        id="repo-description"
        value={description}
        oninput={handleDescriptionInput}
        placeholder="A brief description of your repository"
        rows="3"
        class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
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
          <p class="text-sm text-muted-foreground">
            {description.length}/350 characters
          </p>
        {/if}
      </div>
    </div>

    <!-- Initialize with README -->
    {#if importing}
      <p class="rounded border border-border p-3 text-sm text-muted-foreground">
        Source default branch: <strong>{defaultBranch || "None (empty repository)"}</strong>.
        Existing files, licenses and commit authorship are preserved; no initialization files are
        generated.
      </p>
    {:else}
      <div class="border-t border-border pt-4">
        <div class="space-y-3">
          <h3 class="text-sm font-medium text-foreground">Initialize repository</h3>
          <label class="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={initializeWithReadme}
              onchange={handleReadmeChange}
              class="h-4 w-4 rounded border-input text-primary focus:ring-ring"
            />
            <div>
              <div class="text-sm font-medium text-foreground">Add a README file</div>
              <div class="text-sm text-muted-foreground">
                This is where you can write a long description for your project
              </div>
            </div>
          </label>

          <div class="mt-4 border-t border-border pt-4">
            <div class="space-y-4">
              <div>
                <label for="default-branch" class="mb-2 block text-sm font-medium text-foreground">
                  Default branch name
                </label>
                <input
                  id="default-branch"
                  type="text"
                  value={defaultBranch}
                  oninput={handleBranchInput}
                  placeholder="master"
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <!-- .gitignore Template -->
              <div>
                <label
                  for="gitignore-template"
                  class="mb-2 block text-sm font-medium text-foreground"
                >
                  .gitignore template
                </label>
                <select
                  id="gitignore-template"
                  value={gitignoreTemplate}
                  onchange={handleGitignoreChange}
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {#each gitignoreOptions as option}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </div>

              <!-- License Template -->
              <div>
                <label
                  for="license-template"
                  class="mb-2 block text-sm font-medium text-foreground"
                >
                  License
                </label>
                <select
                  id="license-template"
                  value={licenseTemplate}
                  onchange={handleLicenseChange}
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
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
    {/if}
  </div>
</div>
