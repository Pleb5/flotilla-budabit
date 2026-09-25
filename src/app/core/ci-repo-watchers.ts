import {
  MAX_COMMUNITY_CI_REPO_WATCHERS,
  MAX_CI_REPO_WATCHER_RELAYS,
  normalizeCommunityCiRepoWatchers,
  normalizeCommunityRelay,
  normalizePubkey,
  type CommunityCiRepoWatcher,
} from "./community"

export type CiRepoWatcherDraft = {pubkey: string; relays: string}

export const ciRepoWatcherField = (index: number, field: "pubkey" | "relays") =>
  `ci-repo-watcher-${index}-${field}`

export const makeCiRepoWatcherDrafts = (watchers: CommunityCiRepoWatcher[]): CiRepoWatcherDraft[] =>
  watchers.map(watcher => ({pubkey: watcher.pubkey, relays: watcher.relays.join("\n")}))

export const validateCiRepoWatcherDrafts = (drafts: CiRepoWatcherDraft[]) => {
  const errors: Record<string, string> = {}
  if (drafts.length > MAX_COMMUNITY_CI_REPO_WATCHERS) {
    errors.ciRepoWatchers = `Add no more than ${MAX_COMMUNITY_CI_REPO_WATCHERS} CI repository watchers.`
  }
  const watchers = drafts.map((draft, index) => {
    const pubkey = normalizePubkey(draft.pubkey)
    if (!pubkey) {
      errors[ciRepoWatcherField(index, "pubkey")] =
        "Enter the watcher's npub or 64-character hex public key."
    }
    const lines = draft.relays
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
    const relays = lines.map(normalizeCommunityRelay)
    const invalidIndex = relays.findIndex(relay => !relay)
    if (!lines.length) {
      errors[ciRepoWatcherField(index, "relays")] = "Add at least one relay for this watcher."
    } else if (lines.length > MAX_CI_REPO_WATCHER_RELAYS) {
      errors[ciRepoWatcherField(index, "relays")] =
        `Add no more than ${MAX_CI_REPO_WATCHER_RELAYS} relays per watcher.`
    } else if (invalidIndex !== -1) {
      errors[ciRepoWatcherField(index, "relays")] =
        `Line ${invalidIndex + 1} must be a valid wss:// URL.`
    }
    return {pubkey, relays: relays.filter((relay): relay is string => Boolean(relay))}
  })
  const normalized = Object.keys(errors).length
    ? undefined
    : normalizeCommunityCiRepoWatchers(watchers)
  if (!normalized && !Object.keys(errors).length) {
    errors.ciRepoWatchers = `A watcher can have no more than ${MAX_CI_REPO_WATCHER_RELAYS} combined relay hints.`
  }
  return {watchers: normalized || [], errors}
}
