import {synced, localStorageProvider} from "@welshman/store"

export type GitTab = "my-repos" | "bookmarks" | "snippets"
export type GitMode = "community" | "personal"

export const GIT_TAB_STORAGE_KEY = "git:selected-tab"
export const GIT_MODE_STORAGE_KEY = "git:selected-mode"

const DEFAULT_GIT_TAB: GitTab = "my-repos"
const DEFAULT_GIT_MODE: GitMode = "community"

const readSyncedValue = <T>(key: string, isValid: (value: unknown) => value is T, fallback: T): T => {
  if (typeof localStorage === "undefined") return fallback

  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback

    const value = JSON.parse(raw)
    return isValid(value) ? value : fallback
  } catch {
    return fallback
  }
}

export const getInitialGitTab = () =>
  readSyncedValue<GitTab>(
    GIT_TAB_STORAGE_KEY,
    (value): value is GitTab => value === "my-repos" || value === "bookmarks" || value === "snippets",
    DEFAULT_GIT_TAB,
  )

export const getInitialGitMode = () =>
  readSyncedValue<GitMode>(
    GIT_MODE_STORAGE_KEY,
    (value): value is GitMode => value === "community" || value === "personal",
    DEFAULT_GIT_MODE,
  )

export const gitSelectedTab = synced<GitTab>({
  key: GIT_TAB_STORAGE_KEY,
  defaultValue: DEFAULT_GIT_TAB,
  storage: localStorageProvider,
})

export const gitSelectedMode = synced<GitMode>({
  key: GIT_MODE_STORAGE_KEY,
  defaultValue: DEFAULT_GIT_MODE,
  storage: localStorageProvider,
})
