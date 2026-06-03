import { getContext } from "svelte";
import { REGISTRY, defaultRegistry, type Registry } from "./internal/component-registry.js";

// Svelte 5 runes mode compliant: use this function in your component <script> to get the current registry
export function useRegistry(): Registry {
  return getContext<Registry>(REGISTRY) ?? defaultRegistry;
}

// Advanced: for reactive registry, you could use the context rune (uncomment below if needed)
// import { context } from 'svelte';
// export const registry = context(REGISTRY, defaultRegistry);
