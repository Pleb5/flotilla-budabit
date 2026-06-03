import { writable, derived } from "svelte/store";

import type { CommitDiff } from "@nostr-git/core/types";

export interface DiffStoreState {
  commitDiffs: Map<string, CommitDiff>;
  loadingCommits: Set<string>;
  expandedCommits: Set<string>;
  expandedFiles: Map<string, Set<string>>; // commitSha -> Set<filePath>
  highlightedFiles: string[];
  errors: Map<string, string>;
}

// Create reactive stores
const diffStoreState = writable<DiffStoreState>({
  commitDiffs: new Map(),
  loadingCommits: new Set(),
  expandedCommits: new Set(),
  expandedFiles: new Map(),
  highlightedFiles: [],
  errors: new Map(),
});

export function createDiffStore() {
  const { subscribe, update } = diffStoreState;

  return {
    subscribe,

    // Commit management
    setCommitDiff: (commitSha: string, diff: CommitDiff) => {
      update((state) => {
        state.commitDiffs.set(commitSha, diff);
        state.loadingCommits.delete(commitSha);
        state.errors.delete(commitSha);
        return state;
      });
    },

    setCommitLoading: (commitSha: string, loading: boolean) => {
      update((state) => {
        if (loading) {
          state.loadingCommits.add(commitSha);
        } else {
          state.loadingCommits.delete(commitSha);
        }
        return state;
      });
    },

    setCommitError: (commitSha: string, error: string) => {
      update((state) => {
        state.errors.set(commitSha, error);
        state.loadingCommits.delete(commitSha);
        return state;
      });
    },

    // Expansion management
    toggleCommitExpansion: (commitSha: string) => {
      update((state) => {
        if (state.expandedCommits.has(commitSha)) {
          state.expandedCommits.delete(commitSha);
        } else {
          state.expandedCommits.add(commitSha);
        }
        return state;
      });
    },

    expandCommit: (commitSha: string) => {
      update((state) => {
        state.expandedCommits.add(commitSha);
        return state;
      });
    },

    collapseCommit: (commitSha: string) => {
      update((state) => {
        state.expandedCommits.delete(commitSha);
        return state;
      });
    },

    toggleFileExpansion: (commitSha: string, filePath: string) => {
      update((state) => {
        if (!state.expandedFiles.has(commitSha)) {
          state.expandedFiles.set(commitSha, new Set());
        }
        const fileSet = state.expandedFiles.get(commitSha)!;
        if (fileSet.has(filePath)) {
          fileSet.delete(filePath);
        } else {
          fileSet.add(filePath);
        }
        return state;
      });
    },

    expandFile: (commitSha: string, filePath: string) => {
      update((state) => {
        if (!state.expandedFiles.has(commitSha)) {
          state.expandedFiles.set(commitSha, new Set());
        }
        state.expandedFiles.get(commitSha)!.add(filePath);
        return state;
      });
    },

    // Highlighting
    setHighlightedFiles: (files: string[]) => {
      update((state) => {
        state.highlightedFiles = files;
        return state;
      });
    },

    // Auto-expand highlighted files
    autoExpandHighlightedFiles: () => {
      update((state) => {
        for (const [commitSha, diff] of state.commitDiffs) {
          const commitFileSet = state.expandedFiles.get(commitSha) || new Set();

          for (const file of diff.changes) {
            if (state.highlightedFiles.includes(file.path)) {
              commitFileSet.add(file.path);
              state.expandedCommits.add(commitSha);
            }
          }

          if (commitFileSet.size > 0) {
            state.expandedFiles.set(commitSha, commitFileSet);
          }
        }
        return state;
      });
    },

    // Utilities
    getCommitDiff: (commitSha: string): CommitDiff | undefined => {
      let result: CommitDiff | undefined;
      update((state) => {
        result = state.commitDiffs.get(commitSha);
        return state;
      });
      return result;
    },

    isCommitLoading: (commitSha: string): boolean => {
      let result = false;
      update((state) => {
        result = state.loadingCommits.has(commitSha);
        return state;
      });
      return result;
    },

    isCommitExpanded: (commitSha: string): boolean => {
      let result = false;
      update((state) => {
        result = state.expandedCommits.has(commitSha);
        return state;
      });
      return result;
    },

    isFileExpanded: (commitSha: string, filePath: string): boolean => {
      let result = false;
      update((state) => {
        const fileSet = state.expandedFiles.get(commitSha);
        result = fileSet ? fileSet.has(filePath) : false;
        return state;
      });
      return result;
    },

    // Clear cache
    clear: () => {
      update((state) => ({
        commitDiffs: new Map(),
        loadingCommits: new Set(),
        expandedCommits: new Set(),
        expandedFiles: new Map(),
        highlightedFiles: [],
        errors: new Map(),
      }));
    },
  };
}

// Export singleton instance
export const diffStore = createDiffStore();

// Derived stores for common queries
export const loadingCommitsCount = derived(diffStoreState, ($state) => $state.loadingCommits.size);

export const expandedCommitsCount = derived(
  diffStoreState,
  ($state) => $state.expandedCommits.size
);

export const totalCommitsLoaded = derived(diffStoreState, ($state) => $state.commitDiffs.size);
