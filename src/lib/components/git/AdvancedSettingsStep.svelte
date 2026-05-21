<script lang="ts">
  import { commonHashtags } from "../../stores/hashtags";
  import { PeoplePicker } from "@nostr-git/ui";
  import { Plus, Trash2, X, Hash, Globe, Users, ChevronUp, ChevronDown } from "@lucide/svelte";

  interface Props {
    gitignoreTemplate: string;
    licenseTemplate: string;
    defaultBranch: string;
    authorName: string;
    authorEmail: string;
    maintainers: string[];
    relays: string[];
    mandatoryRelays?: string[];
    tags: string[];
    webUrls: string[];
    cloneUrls: string[];
    onGitignoreChange: (template: string) => void;
    onLicenseChange: (template: string) => void;
    onDefaultBranchChange: (branch: string) => void;
    onAuthorNameChange: (name: string) => void;
    onAuthorEmailChange: (email: string) => void;
    onMaintainersChange: (maintainers: string[]) => void;
    onRelaysChange: (relays: string[]) => void;
    onTagsChange: (tags: string[]) => void;
    onWebUrlsChange: (urls: string[]) => void;
    onCloneUrlsChange: (urls: string[]) => void;
    getProfile?: (
      pubkey: string
    ) => Promise<{ name?: string; picture?: string; nip05?: string; display_name?: string } | null>;
    searchProfiles?: (query: string) => Promise<
      Array<{
        pubkey: string;
        name?: string;
        picture?: string;
        nip05?: string;
        display_name?: string;
      }>
    >;
    searchRelays?: (query: string) => Promise<string[]>;
  }

  const {
    gitignoreTemplate,
    licenseTemplate,
    defaultBranch,
    authorName,
    authorEmail,
    maintainers,
    relays,
    mandatoryRelays = [],
    tags,
    webUrls,
    cloneUrls,
    onGitignoreChange,
    onLicenseChange,
    onDefaultBranchChange,
    onAuthorNameChange,
    onAuthorEmailChange,
    onMaintainersChange,
    onRelaysChange,
    onTagsChange,
    onWebUrlsChange,
    onCloneUrlsChange,
    getProfile,
    searchProfiles,
    searchRelays,
  }: Props = $props();

  // Autocomplete state for relays
  let relaySearchQuery = $state("");
  let relaySearchResults = $state<string[]>([]);
  let showRelayAutocomplete = $state(false);
  let relayInputElement: HTMLInputElement | undefined = $state();

  // Autocomplete state for hashtags
  let hashtagSearchQuery = $state("");
  let hashtagSearchResults = $state<string[]>([]);
  let showHashtagAutocomplete = $state(false);
  let hashtagInputElement: HTMLInputElement | undefined = $state();
  let highlightedHashtagIndex = $state(-1);

  const gitignoreOptions = [
    { value: "", label: "None" },
    { value: "node", label: "Node.js" },
    { value: "python", label: "Python" },
    { value: "web", label: "Web Development" },
    { value: "svelte", label: "Svelte" },
  ];

  const licenseOptions = [
    { value: "", label: "None" },
    { value: "mit", label: "MIT License" },
    { value: "apache-2.0", label: "Apache License 2.0" },
  ];

  // Handle relay search with debounce
  let relaySearchTimeout: ReturnType<typeof setTimeout> | null = null;

  function normalizeRelayValue(value: string): string {
    return (value || "").trim().replace(/\/+$/, "");
  }

  function hasRelay(relayUrl: string): boolean {
    const normalized = normalizeRelayValue(relayUrl);

    return [...mandatoryRelays, ...relays].some(
      (existing) => normalizeRelayValue(existing) === normalized
    );
  }

  $effect(() => {
    const query = relaySearchQuery;
    if (relaySearchTimeout) clearTimeout(relaySearchTimeout);

    if (query && searchRelays) {
      relaySearchTimeout = setTimeout(async () => {
        try {
          const results = await searchRelays(query);
          relaySearchResults = results.filter((relayUrl) => !hasRelay(relayUrl));
          showRelayAutocomplete = relaySearchResults.length > 0;
        } catch (e) {
          console.error("Failed to search relays", e);
          relaySearchResults = [];
        }
      }, 300);
    } else {
      relaySearchResults = [];
      showRelayAutocomplete = false;
    }

    return () => {
      if (relaySearchTimeout) clearTimeout(relaySearchTimeout);
    };
  });

  // Normalize hashtag: strip #, lowercase, trim
  function normalizeHashtag(tag: string): string {
    return tag.toLowerCase().replace(/^#/, "").trim();
  }

  // Check if a tag already exists (case-insensitive)
  function tagExists(tag: string): boolean {
    const normalized = normalizeHashtag(tag);
    return tags.some((t) => normalizeHashtag(t) === normalized);
  }

  // Get normalized query (helper for derived computations)
  function getNormalizedQuery(): string {
    return normalizeHashtag(hashtagSearchQuery);
  }

  // Check if we can create a custom tag
  function canCreateCustomTag(): boolean {
    const normalized = getNormalizedQuery();
    return normalized.length > 0 && !tagExists(normalized);
  }

  // Get total number of hashtag options
  function getTotalHashtagOptions(): number {
    return hashtagSearchResults.length + (canCreateCustomTag() ? 1 : 0);
  }

  // Handle hashtag search (client-side filtering)
  $effect(() => {
    const query = hashtagSearchQuery.trim();

    if (query) {
      const normalized = normalizeHashtag(query);
      hashtagSearchResults = commonHashtags.search(normalized, 10);
      // Show autocomplete if there's a query (we'll show results or "create" option)
      showHashtagAutocomplete = true;
    } else {
      hashtagSearchResults = [];
      showHashtagAutocomplete = false;
    }
    // Reset highlighted index when query changes
    highlightedHashtagIndex = -1;
  });

  function addHashtag(tag: string) {
    const normalized = normalizeHashtag(tag);
    if (normalized && !tagExists(normalized)) {
      onTagsChange([...tags, normalized]);
      resetHashtagInput();
    }
  }

  function resetHashtagInput() {
    hashtagSearchQuery = "";
    showHashtagAutocomplete = false;
    highlightedHashtagIndex = -1;
  }

  function handleHashtagKeydown(e: KeyboardEvent) {
    // Handle Enter when autocomplete is closed
    if (!showHashtagAutocomplete && e.key === "Enter" && hashtagSearchQuery.trim()) {
      e.preventDefault();
      addHashtag(hashtagSearchQuery);
      return;
    }

    if (!showHashtagAutocomplete) return;

    const totalOptions = getTotalHashtagOptions();
    const canCreate = canCreateCustomTag();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        highlightedHashtagIndex = Math.min(highlightedHashtagIndex + 1, totalOptions - 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        highlightedHashtagIndex = Math.max(highlightedHashtagIndex - 1, -1);
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedHashtagIndex >= 0 && highlightedHashtagIndex < hashtagSearchResults.length) {
          // Select from suggestions
          addHashtag(hashtagSearchResults[highlightedHashtagIndex]);
        } else if (highlightedHashtagIndex === hashtagSearchResults.length && canCreate) {
          // Create custom tag (last option)
          addHashtag(hashtagSearchQuery);
        } else if (canCreate) {
          // No highlight, but can create
          addHashtag(hashtagSearchQuery);
        }
        break;
      case "Escape":
        e.preventDefault();
        resetHashtagInput();
        break;
    }
  }

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

  // Helpers for multi-value fields
  function addItem(arr: string[], onChange: (v: string[]) => void) {
    onChange([...(arr || []), ""]);
  }
  function removeItem(arr: string[], index: number, onChange: (v: string[]) => void) {
    onChange((arr || []).filter((_, i) => i !== index));
  }
  function updateItem(
    arr: string[],
    index: number,
    value: string,
    onChange: (v: string[]) => void
  ) {
    onChange((arr || []).map((item, i) => (i === index ? value : item)));
  }

  function moveCloneUrl(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= cloneUrls.length) return;
    const next = [...cloneUrls];
    [next[index], next[target]] = [next[target], next[index]];
    onCloneUrlsChange(next);
  }
</script>

<div class="space-y-6">
  <div class="space-y-4">
    <h2 class="text-xl font-semibold text-gray-100">Advanced Settings</h2>
    <p class="text-sm text-gray-300">Configure additional options for your repository.</p>
  </div>

  <div class="space-y-6">
    <!-- Author Information -->
    <div class="border-t border-gray-200 dark:border-gray-700 pt-6">
      <h3 class="text-lg font-medium text-gray-100 mb-4">Author Information</h3>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label for="author-name" class="block text-sm font-medium text-gray-300 mb-2">
            Author Name *
          </label>
          <input
            id="author-name"
            type="text"
            value={authorName}
            oninput={(e) => onAuthorNameChange((e.target as HTMLInputElement).value)}
            placeholder="Your full name"
            class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
            required
          />
        </div>

        <div>
          <label for="author-email" class="block text-sm font-medium text-gray-300 mb-2">
            Author Email *
          </label>
          <input
            id="author-email"
            type="email"
            value={authorEmail}
            oninput={(e) => onAuthorEmailChange((e.target as HTMLInputElement).value)}
            placeholder="your.email@example.com"
            class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
            required
          />
        </div>
      </div>
    </div>

    <!-- NIP-34 Repository Metadata -->
    <div class="border-t border-gray-200 dark:border-gray-700 pt-6">
      <h3 class="text-lg font-medium text-gray-100 mb-4">Repository Metadata (NIP-34)</h3>

      <div class="space-y-4">
        <!-- Web URLs -->
        <fieldset>
          <legend class="block text-sm font-medium text-gray-300 mb-2"> Web URLs </legend>
          <div class="space-y-2">
            {#each webUrls as url, index}
              <div class="flex items-center space-x-2">
                <input
                  type="url"
                  value={webUrls[index]}
                  oninput={(e) =>
                    updateItem(
                      webUrls,
                      index,
                      (e.target as HTMLInputElement).value,
                      onWebUrlsChange
                    )}
                  placeholder="https://github.com/user/repo"
                  class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
                />
                <button
                  type="button"
                  class="p-2 text-red-400 hover:text-red-300"
                  aria-label="Remove web URL"
                  onclick={() => removeItem(webUrls, index, onWebUrlsChange)}
                >
                  Remove
                </button>
              </div>
            {/each}
            <button
              type="button"
              class="px-3 py-2 text-blue-400 hover:text-blue-300"
              onclick={() => addItem(webUrls, onWebUrlsChange)}
            >
              Add web URL
            </button>
          </div>
          <p class="mt-1 text-sm text-gray-400">URL(s) for browsing the repository online</p>
        </fieldset>

        <!-- Clone URLs -->
        <fieldset>
          <legend class="block text-sm font-medium text-gray-300 mb-2"> Clone URLs </legend>
          <div class="space-y-2">
            {#if cloneUrls.length === 0}
              <p class="text-sm text-gray-400">
                No clone URLs available for the selected providers yet.
              </p>
            {/if}
            {#each cloneUrls as url, index}
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="p-1 text-gray-400 hover:text-gray-200 disabled:opacity-40"
                  aria-label="Move clone URL up"
                  disabled={index === 0}
                  onclick={() => moveCloneUrl(index, -1)}
                >
                  <ChevronUp class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="p-1 text-gray-400 hover:text-gray-200 disabled:opacity-40"
                  aria-label="Move clone URL down"
                  disabled={index === cloneUrls.length - 1}
                  onclick={() => moveCloneUrl(index, 1)}
                >
                  <ChevronDown class="w-4 h-4" />
                </button>
                <input
                  type="text"
                  value={cloneUrls[index]}
                  readonly
                  class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-gray-800/60 text-gray-100"
                />
                {#if index === 0}
                  <span
                    class="px-2 py-1 text-xs rounded bg-blue-500/20 text-blue-300 border border-blue-500/30"
                    >Primary</span
                  >
                {/if}
              </div>
            {/each}
          </div>
          <p class="mt-1 text-sm text-gray-400">
            Reorder to choose priority. The first URL is the primary clone URL.
          </p>
        </fieldset>

        <!-- Tags -->
        <fieldset>
          <legend class="block text-sm font-medium text-gray-300 mb-2">
            <Hash class="w-4 h-4 inline mr-1" />
            Tags/Topics
          </legend>

          <!-- Selected tags -->
          {#if tags.length > 0}
            <div class="flex flex-wrap gap-2 mb-2">
              {#each tags as tag}
                <div class="flex items-center gap-2 bg-gray-700 rounded-lg px-3 py-2 text-sm">
                  <Hash class="w-3 h-3 text-gray-400" />
                  <span class="text-white text-sm">{tag}</span>
                  <button
                    onclick={() => onTagsChange(tags.filter((t) => t !== tag))}
                    class="text-gray-400 hover:text-gray-200 transition-colors"
                    aria-label="Remove tag"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                      ></path>
                    </svg>
                  </button>
                </div>
              {/each}
            </div>
          {/if}

          <!-- Search input for adding tags -->
          <div class="relative">
            <input
              bind:this={hashtagInputElement}
              type="text"
              bind:value={hashtagSearchQuery}
              onfocus={() => {
                if (hashtagSearchQuery.trim()) {
                  showHashtagAutocomplete = hashtagSearchResults.length > 0 || canCreateCustomTag();
                }
              }}
              onblur={() => {
                // Delay closing to allow click events on suggestions to fire first
                setTimeout(() => {
                  showHashtagAutocomplete = false;
                  highlightedHashtagIndex = -1;
                }, 250);
              }}
              onkeydown={handleHashtagKeydown}
              autocomplete="off"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              placeholder="Search or type to add tags (press Enter)"
            />
            {#if showHashtagAutocomplete}
              <div
                id="hashtag-suggestions-listbox"
                role="listbox"
                aria-label="Hashtag suggestions"
                class="absolute z-[50] w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto"
              >
                {#each hashtagSearchResults as tag, index}
                  {@const isAlreadyAdded = tagExists(tag)}
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlightedHashtagIndex}
                    disabled={isAlreadyAdded}
                    onmousedown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onclick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!isAlreadyAdded) {
                        addHashtag(tag);
                      }
                    }}
                    class="w-full text-left px-3 py-2 text-sm flex items-center gap-2
                           {index === highlightedHashtagIndex ? 'bg-gray-700' : 'hover:bg-gray-700'}
                           {isAlreadyAdded ? 'opacity-50 cursor-not-allowed' : ''}"
                  >
                    <Hash class="w-3 h-3 text-gray-400" />
                    <span class="flex-1">{tag}</span>
                    {#if isAlreadyAdded}
                      <span class="text-xs text-gray-400">(already added)</span>
                    {/if}
                  </button>
                {/each}
                {#if canCreateCustomTag()}
                  <button
                    type="button"
                    role="option"
                    aria-selected={highlightedHashtagIndex === hashtagSearchResults.length}
                    onmousedown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onclick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      addHashtag(hashtagSearchQuery);
                    }}
                    class="w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-t border-gray-700
                           {highlightedHashtagIndex === hashtagSearchResults.length
                      ? 'bg-gray-700'
                      : 'hover:bg-gray-700'}"
                  >
                    <Plus class="w-3 h-3 text-blue-400" />
                    <span class="text-blue-400 font-medium">Create tag: {getNormalizedQuery()}</span
                    >
                  </button>
                {/if}
              </div>
            {/if}
          </div>
          <p class="mt-1 text-sm text-gray-400">Add tags or topics for this repository</p>
        </fieldset>

        <!-- Maintainers -->
        <fieldset>
          <legend class="block text-sm font-medium text-gray-300 mb-2">
            <Users class="w-4 h-4 inline mr-1" />
            Additional Maintainers
          </legend>
          <PeoplePicker
            selected={maintainers}
            placeholder="Search by name, nip-05, or npub..."
            maxSelections={50}
            showAvatars={true}
            showSuggestionsOnFocus={true}
            compact={false}
            getProfile={getProfile}
            searchProfiles={searchProfiles}
            add={(pubkey: string) => {
              if (!maintainers.includes(pubkey)) {
                onMaintainersChange([...maintainers, pubkey]);
              }
            }}
            remove={(pubkey: string) => {
              onMaintainersChange(maintainers.filter((p) => p !== pubkey));
            }}
          />
          <p class="mt-1 text-sm text-gray-400">Maintainer public keys (npub or hex)</p>
        </fieldset>

        <!-- Relays -->
        <fieldset>
          <legend class="block text-sm font-medium text-gray-300 mb-2">
            <Globe class="w-4 h-4 inline mr-1" />
            Preferred Relays
          </legend>
          <div class="space-y-2">
            {#each mandatoryRelays as relayUrl}
              <div class="flex items-center space-x-2">
                <input
                  type="text"
                  value={relayUrl}
                  readonly
                  aria-label="GRASP target relay"
                  class="flex-1 px-3 py-2 border border-blue-500/40 rounded-md shadow-sm bg-gray-800/60 text-gray-100 focus:outline-none"
                />
                <span
                  class="px-2 py-1 text-xs rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 whitespace-nowrap"
                >
                  GRASP target
                </span>
              </div>
            {/each}

            {#each relays as r, index}
              <div class="flex items-center space-x-2">
                <input
                  type="text"
                  value={relays[index]}
                  oninput={(e) =>
                    updateItem(relays, index, (e.target as HTMLInputElement).value, onRelaysChange)}
                  placeholder="wss://relay.example.com"
                  class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
                />
                <button
                  type="button"
                  class="p-2 text-red-400 hover:text-red-300"
                  aria-label="Remove relay"
                  onclick={() => removeItem(relays, index, onRelaysChange)}
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            {/each}

            <!-- Autocomplete input for adding relays -->
            {#if searchRelays}
              <div class="relative">
                <input
                  bind:this={relayInputElement}
                  type="text"
                  bind:value={relaySearchQuery}
                  onfocus={() => (showRelayAutocomplete = relaySearchResults.length > 0)}
                  onblur={(e) => {
                    // Delay closing to allow click events on suggestions to fire first
                    setTimeout(() => {
                      if (
                        !e.relatedTarget ||
                        !(e.relatedTarget as HTMLElement).closest("#relay-suggestions-listbox")
                      ) {
                        showRelayAutocomplete = false;
                      }
                    }, 200);
                  }}
                  autocomplete="off"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
                  placeholder="Search for relays..."
                />
                {#if showRelayAutocomplete && relaySearchResults.length > 0}
                  <div
                    id="relay-suggestions-listbox"
                    class="fixed z-50 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                    style="width: {relayInputElement?.getBoundingClientRect().width ||
                      '100%'}px; left: {relayInputElement?.getBoundingClientRect().left ||
                      0}px; top: {(relayInputElement?.getBoundingClientRect().bottom || 0) + 4}px;"
                  >
                    {#each relaySearchResults as relayUrl}
                      <button
                        type="button"
                        onmousedown={(e) => {
                          // Prevent input blur from firing before click
                          e.preventDefault();
                        }}
                        onclick={() => {
                          if (!hasRelay(relayUrl)) {
                            onRelaysChange([...relays, relayUrl]);
                          }
                          relaySearchQuery = "";
                          showRelayAutocomplete = false;
                        }}
                        class="w-full text-left px-3 py-2 hover:bg-gray-700 text-sm font-mono"
                      >
                        {relayUrl}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {:else}
              <button
                type="button"
                class="px-3 py-2 text-blue-400 hover:text-blue-300"
                onclick={() => addItem(relays, onRelaysChange)}
              >
                <Plus class="w-4 h-4 inline mr-1" />
                Add relay
              </button>
            {/if}
          </div>
          <p class="mt-1 text-sm text-gray-400">
            Preferred relay URLs (wss://). Selected GRASP target relays are included automatically.
          </p>
        </fieldset>
      </div>
    </div>
  </div>
</div>
