import {synced, localStorageProvider} from "@welshman/store"

export type GitTab = "my-repos" | "bookmarks" | "snippets"

export const GIT_TAB_STORAGE_KEY = "git:selected-tab"

export const gitSelectedTab = synced<GitTab>({
  key: GIT_TAB_STORAGE_KEY,
  defaultValue: "my-repos",
  storage: localStorageProvider,
})
