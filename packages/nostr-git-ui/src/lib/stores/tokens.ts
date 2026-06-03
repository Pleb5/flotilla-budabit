import { writable } from "svelte/store";

export interface Token {
  host: string;
  token: string;
}

// Browser detection that works in all environments
const isBrowser = typeof window !== "undefined" && typeof localStorage !== "undefined";

function createTokenStore() {
  const { subscribe, update, set } = writable<Token[]>([]);
  let isInitialized = false;
  let loadTokensFunction: (() => Promise<Token[]>) | null = null;

  // Set the token loading function (to be called from the app layer)
  function setTokenLoader(loader: () => Promise<Token[]>) {
    loadTokensFunction = loader;
    console.log("🔐 Token loader set, ready for lazy initialization");
  }

  // Initialize tokens from localStorage when explicitly called
  async function initialize(): Promise<void> {
    if (isInitialized || !isBrowser || !loadTokensFunction) {
      return;
    }

    try {
      console.log("🔐 Token store initializing, attempting to load tokens...");
      const loadedTokens = await loadTokensFunction();

      if (loadedTokens.length > 0) {
        console.log(`🔐 Loaded ${loadedTokens.length} tokens from localStorage`);
        set(loadedTokens);
      } else {
        console.log("🔐 No tokens found or signer not ready, setting empty array");
        set([]);
      }

      isInitialized = true;
    } catch (error) {
      console.warn("🔐 Failed to load tokens from localStorage:", error);
      // Set empty array as fallback
      set([]);
      isInitialized = true;
    }
  }

  function push(token: Token) {
    update((tokens) => [...tokens, token]);
  }

  function clear() {
    set([]);
  }

  // Ensure tokens are loaded before returning current state
  async function waitForInitialization(): Promise<Token[]> {
    // If not initialized yet, trigger initialization
    if (!isInitialized) {
      await initialize();
    }

    return new Promise((resolve) => {
      let cleanup: (() => void) | null = null;

      cleanup = subscribe((tokens) => {
        if (cleanup) {
          cleanup();
          cleanup = null;
        }
        resolve(tokens);
      });
    });
  }

  // Manual refresh function for when initial load fails
  async function refresh(): Promise<void> {
    if (!isBrowser || !loadTokensFunction) {
      return;
    }

    try {
      console.log("🔐 Manually refreshing token store...");
      const loadedTokens = await loadTokensFunction();

      if (loadedTokens.length > 0) {
        console.log(`🔐 Refreshed with ${loadedTokens.length} tokens from localStorage`);
        set(loadedTokens);
      } else {
        console.log("🔐 No tokens found during refresh");
        set([]);
      }
    } catch (error) {
      console.warn("🔐 Failed to refresh tokens:", error);
      set([]);
    }
  }

  return {
    subscribe,
    push,
    clear,
    waitForInitialization,
    setTokenLoader,
    refresh,
  };
}

export const tokens = createTokenStore();
