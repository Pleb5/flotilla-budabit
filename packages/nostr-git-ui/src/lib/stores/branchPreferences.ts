import { synced, localStorageProvider } from "@welshman/store";
import { get } from "svelte/store";

import { normalizeGitRefName } from "../components/git/branch-ref";

export const BRANCH_PREFERENCES_KEY = "nostr-git:branch-preferences";

export type BranchPreferences = {
  selectedByRepo: Record<string, string>;
};

export const defaultBranchPreferences: BranchPreferences = {
  selectedByRepo: {},
};

export const branchPreferences = synced({
  key: BRANCH_PREFERENCES_KEY,
  defaultValue: defaultBranchPreferences,
  storage: localStorageProvider,
});

export function getSelectedBranchPreference(repoKey?: string): string {
  const key = String(repoKey || "").trim();
  if (!key) return "";

  const preferences = get(branchPreferences) as BranchPreferences;
  return normalizeGitRefName(preferences?.selectedByRepo?.[key] || "");
}

export function setSelectedBranchPreference(repoKey: string | undefined, branchName?: string): void {
  const key = String(repoKey || "").trim();
  const branch = normalizeGitRefName(branchName || "");
  if (!key || !branch) return;

  branchPreferences.update((preferences: BranchPreferences) => ({
    ...defaultBranchPreferences,
    ...preferences,
    selectedByRepo: {
      ...(preferences?.selectedByRepo || {}),
      [key]: branch,
    },
  }));
}
