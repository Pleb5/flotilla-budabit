import { writable } from 'svelte/store';

// Common hashtags for git repos
const defaultHashtags = [
  "bitcoin", "nostr", "lightning", "rust", "javascript", "typescript", "python", 
  "go", "java", "cpp", "web", "mobile", "desktop", "cli", "library", "framework",
  "tool", "app", "game", "bot", "api", "frontend", "backend", "fullstack",
  "opensource", "foss", "privacy", "security", "crypto", "blockchain", "p2p",
  "react", "vue", "svelte", "angular", "nodejs", "deno", "bun", "docker", "kubernetes",
  "ai", "ml", "machinelearning", "deeplearning", "datascience", "analytics",
  "testing", "devops", "cicd", "automation", "monitoring", "logging",
  "database", "sql", "nosql", "graphql", "rest", "grpc", "websocket",
  "ui", "ux", "design", "accessibility", "performance", "optimization"
];

function createHashtagStore() {
  const { subscribe, set, update } = writable<string[]>(defaultHashtags);

  return {
    subscribe,
    set,
    update,
    // Add a custom hashtag to the list
    add: (hashtag: string) => update(tags => {
      const normalized = hashtag.toLowerCase().replace(/^#/, '');
      if (!tags.includes(normalized)) {
        return [...tags, normalized].sort();
      }
      return tags;
    }),
    // Search hashtags by query
    search: (query: string, limit = 10): string[] => {
      const normalizedQuery = query.toLowerCase().replace(/^#/, '');
      if (!normalizedQuery) return [];
      
      let results: string[] = [];
      subscribe(tags => {
        results = tags
          .filter(tag => tag.toLowerCase().includes(normalizedQuery))
          .slice(0, limit);
      })();
      
      return results;
    },
    // Reset to default hashtags
    reset: () => set(defaultHashtags)
  };
}

export const commonHashtags = createHashtagStore();
