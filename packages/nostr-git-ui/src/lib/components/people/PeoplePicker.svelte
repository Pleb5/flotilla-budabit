<script lang="ts">
  import { onDestroy } from "svelte";
  import UserAvatar from "../UserAvatar.svelte";
  import { nip19 } from "nostr-tools";
  import { Plus } from "@lucide/svelte";
  import { resolveNip05Cached } from "@nostr-git/core/utils";
  import type { LabelEvent } from "@nostr-git/core/events";

  export interface PersonProfile {
    name?: string;
    picture?: string;
    nip05?: string;
    display_name?: string;
  }

  export interface PersonSuggestion extends PersonProfile {
    pubkey: string;
  }

  export interface Props {
    selected?: LabelEvent[] | string[];
    placeholder?: string;
    disabled?: boolean;
    maxSelections?: number;
    showAvatars?: boolean;
    compact?: boolean;
    suggestionLimit?: number;
    showSuggestionsOnFocus?: boolean;
    getProfile?: (pubkey: string) => Promise<PersonProfile | null>;
    searchProfiles?: (query: string) => Promise<PersonSuggestion[]>;
    add?: (pubkey: string) => void | Promise<void>;
    remove?: (pubkey: string) => void | Promise<void>;
    onDeleteLabel?: (evt: LabelEvent) => void | Promise<void>;
  }

  const {
    selected = $bindable(),
    placeholder = "Search for people...",
    disabled = false,
    maxSelections = 10,
    showAvatars = true,
    suggestionLimit = 10,
    showSuggestionsOnFocus = false,
    getProfile,
    searchProfiles,
    add,
    remove,
    onDeleteLabel,
  }: Props = $props();

  let inputValue = $state("");
  let suggestions = $state<PersonSuggestion[]>([]);
  let open = $state(false);
  let highlighted = $state(-1);
  let loading = $state(false);
  let resolving = $state(false);
  let profileCache = $state(new Map<string, PersonProfile>());
  let inputEl = $state<HTMLInputElement | null>(null);

  const showMobileAdd = $derived(!disabled && inputValue.trim().length > 0);
  const isAddDisabled = $derived(disabled || !inputValue.trim() || resolving);

  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (!searchProfiles) return;
    const query = inputValue.trim();
    if (searchTimeout) clearTimeout(searchTimeout);
    if (!query && !showSuggestionsOnFocus) {
      suggestions = [];
      open = false;
      return;
    }
    searchTimeout = setTimeout(
      async () => {
        loading = true;
        try {
          const res = await searchProfiles(query);
          suggestions = res.slice(0, suggestionLimit);
          open = document.activeElement === inputEl && suggestions.length > 0;
        } catch (e) {
          console.error("searchProfiles failed", e);
          suggestions = [];
          open = false;
        } finally {
          loading = false;
        }
      },
      query ? 300 : 0
    );
  });

  onDestroy(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
  });

  function normalizePubkey(input: string): string {
    if (input.startsWith("npub")) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === "npub") {
          return decoded.data;
        }
      } catch (e) {
        console.warn("Failed to decode npub:", e);
      }
    }
    return input;
  }

  function isHexPubkey(value: string): boolean {
    return /^[a-fA-F0-9]{64}$/.test(value);
  }

  function isNpub(value: string): boolean {
    return /^npub1[ac-hj-np-z02-9]{58}$/i.test(value);
  }

  function looksLikeNip05(value: string): boolean {
    return /^[^@\s]+@[^@\s]+$/.test(value);
  }

  async function ensureProfile(pubkey: string) {
    if (!getProfile || profileCache.has(pubkey)) return;
    try {
      const prof = await getProfile(pubkey);
      if (prof) {
        profileCache.set(pubkey, prof);
        profileCache = new Map(profileCache);
      }
    } catch (e) {
      console.warn("getProfile failed", e);
    }
  }

  function addSelection(pubkey: string) {
    const normalized = normalizePubkey(pubkey);
    add?.(normalized);
  }

  async function addFromInput(): Promise<boolean> {
    const raw = inputValue.trim();
    if (!raw) return false;

    if (isHexPubkey(raw)) {
      addSelection(raw.toLowerCase());
      inputValue = "";
      open = false;
      highlighted = -1;
      return true;
    }

    if (isNpub(raw)) {
      try {
        const decoded = nip19.decode(raw);
        if (decoded.type === "npub" && typeof decoded.data === "string") {
          addSelection(decoded.data.toLowerCase());
          inputValue = "";
          open = false;
          highlighted = -1;
          return true;
        }
      } catch (e) {
        console.warn("Failed to decode npub:", e);
      }
      return false;
    }

    if (looksLikeNip05(raw)) {
      resolving = true;
      try {
        const resolved = await resolveNip05Cached(raw);
        if (resolved) {
          addSelection(resolved.toLowerCase());
          inputValue = "";
          open = false;
          highlighted = -1;
          return true;
        }
      } catch (e) {
        console.warn("Failed to resolve nip05:", e);
      } finally {
        resolving = false;
      }
    }

    return false;
  }

  function getEventPubkey(evt: LabelEvent | string): string | undefined {
    // Handle string (pubkey) directly
    if (typeof evt === "string") {
      return normalizePubkey(evt);
    }
    // Handle LabelEvent
    if (evt && typeof evt === "object" && "tags" in evt && Array.isArray(evt.tags)) {
      const p = evt.tags.find((t) => t[0] === "p");
      return p?.[1];
    }
    return undefined;
  }

  function removeSelection(evt: LabelEvent | string) {
    if (typeof evt === "string") {
      // For string arrays, use remove callback if provided
      if (remove) {
        remove(normalizePubkey(evt));
      } else if (selected && Array.isArray(selected)) {
        // If remove is not provided, try to find matching LabelEvent
        const isStringArray = selected.length === 0 || typeof selected[0] === "string";
        if (!isStringArray) {
          // Find the matching LabelEvent and call onDeleteLabel
          const eventArray = selected as LabelEvent[];
          const matchingEvent = eventArray.find((item) => {
            const itemPubkey = getEventPubkey(item);
            return itemPubkey === normalizePubkey(evt);
          });
          if (matchingEvent && onDeleteLabel) {
            onDeleteLabel(matchingEvent);
          }
        }
      }
    } else if (evt && onDeleteLabel) {
      onDeleteLabel(evt);
    }
  }

  function onKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        if (!open) return;
        e.preventDefault();
        highlighted = Math.min(highlighted + 1, suggestions.length - 1);
        break;
      case "ArrowUp":
        if (!open) return;
        e.preventDefault();
        highlighted = Math.max(highlighted - 1, -1);
        break;
      case "Enter":
        e.preventDefault();
        if (open && highlighted >= 0 && suggestions[highlighted]) {
          addSelection(suggestions[highlighted].pubkey);
          inputValue = "";
          open = false;
          highlighted = -1;
          return;
        }
        void addFromInput();
        break;
      case "Escape":
        if (!open) return;
        e.preventDefault();
        open = false;
        highlighted = -1;
        break;
      case "Backspace":
        if (!inputValue && (selected?.length || 0) > 0 && selected) {
          e.preventDefault();
          removeSelection(selected[selected.length - 1] as LabelEvent | string);
        }
        break;
    }
  }

  // Ensure profiles are cached for selected and suggestions
  $effect(() => {
    const keys = (selected || [])
      .map((item: LabelEvent | string) => {
        if (typeof item === "string") {
          return normalizePubkey(item);
        }
        return getEventPubkey(item as LabelEvent);
      })
      .filter(Boolean) as string[];
    [...keys, ...suggestions.map((s) => s.pubkey)].forEach((pubkey) => {
      ensureProfile(pubkey || "");
    });
  });
</script>

<div class="space-y-2">
  <!-- Selected people -->
  {#if selected?.length || 0}
    <div class="flex flex-wrap gap-2">
      {#each selected as evt}
        {@const pubkey = getEventPubkey(evt)}
        <div class="flex items-center gap-2 bg-gray-700 rounded-lg px-3 py-2 text-sm">
          {#if showAvatars}
            <UserAvatar pubkey={pubkey} profile={profileCache.get(pubkey || "")} size="sm" />
          {:else}
            <span class="text-gray-300">{pubkey?.slice(0, 8)}...</span>
          {/if}
          <div class="flex-1 min-w-0">
            <div class="text-white text-sm truncate">
              {(() => {
                const profile = pubkey ? profileCache.get(pubkey) : undefined;
                return (
                  profile?.display_name ||
                  profile?.name ||
                  profile?.nip05 ||
                  (pubkey ? pubkey.slice(0, 16) + "..." : "")
                );
              })()}
            </div>
          </div>
          {#if !disabled}
            <button
              type="button"
              onclick={() => removeSelection(evt)}
              class="text-gray-400 hover:text-gray-200 transition-colors"
              aria-label="Remove"
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
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Search input -->
  {#if (selected?.length || 0) < maxSelections}
    <div class="relative">
      <input
        bind:this={inputEl}
        bind:value={inputValue}
        onkeydown={onKeydown}
        onfocus={() => (open = suggestions.length > 0)}
        onblur={(e) => {
          // Delay closing to allow click events on suggestions to fire first
          setTimeout(() => {
            // Only close if focus didn't move to a suggestion button
            if (
              !e.relatedTarget ||
              !(e.relatedTarget as HTMLElement).closest("#suggestions-listbox")
            ) {
              open = false;
            }
          }, 150);
        }}
        placeholder={placeholder}
        disabled={disabled}
        class="w-full px-3 pr-12 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        aria-expanded={open}
        aria-controls="suggestions-listbox"
        aria-haspopup="listbox"
        role="combobox"
        aria-autocomplete="list"
      />

      {#if loading || resolving || showMobileAdd}
        <div class="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
          {#if loading || resolving}
            <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
          {/if}
          {#if showMobileAdd}
            <button
              type="button"
              class="sm:hidden inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-600 bg-gray-800 text-gray-200 hover:bg-gray-700 disabled:opacity-50"
              aria-label="Add person"
              onclick={() => void addFromInput()}
              disabled={isAddDisabled}
            >
              <Plus class="h-4 w-4" />
            </button>
          {/if}
        </div>
      {/if}

      <!-- Suggestions dropdown -->
      {#if open && suggestions.length > 0}
        <div
          class="absolute z-[50] w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto"
        >
          <ul id="suggestions-listbox" role="listbox" aria-label="Search suggestions">
            {#each suggestions as suggestion, index}
              <li role="option" aria-selected={index === highlighted}>
                <button
                  type="button"
                  class="w-full px-3 py-2 cursor-pointer hover:bg-gray-700 {index === highlighted
                    ? 'bg-gray-700'
                    : ''} text-left"
                  onmousedown={(e) => {
                    // Prevent input blur from firing before click
                    e.preventDefault();
                  }}
                  onclick={() => {
                    addSelection(suggestion.pubkey);
                    inputValue = "";
                    open = false;
                    highlighted = -1;
                  }}
                >
                  <div class="flex items-center gap-3">
                    {#if showAvatars}
                      <UserAvatar
                        pubkey={suggestion.pubkey}
                        profile={profileCache.get(suggestion.pubkey)}
                        size="sm"
                      />
                    {:else}
                      <span class="text-gray-300">{suggestion.pubkey.slice(0, 8)}...</span>
                    {/if}
                    <div class="flex-1 min-w-0">
                      <div class="text-white text-sm truncate">
                        {suggestion.display_name ||
                          suggestion.name ||
                          suggestion.nip05 ||
                          suggestion.pubkey.slice(0, 16) + "..."}
                      </div>
                      {#if suggestion.nip05 && suggestion.nip05 !== suggestion.display_name && suggestion.nip05 !== suggestion.name}
                        <div class="text-gray-400 text-xs truncate">{suggestion.nip05}</div>
                      {/if}
                    </div>
                  </div>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style lang="postcss">
  /* Ensure dropdown appears above other elements */
  .relative {
    position: relative;
  }
</style>
