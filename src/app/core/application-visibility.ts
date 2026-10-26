import {writable} from "svelte/store"

type Visibility = {hiddenIds: Set<string>; error?: string}
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "key" | "length">
const eventIdPattern = /^[0-9a-f]{64}$/
const readError = "Hidden applications could not be read. Your saved preferences were preserved."
const getStorage = (): Storage | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** Personal browser-only preferences; never a community review or membership event. */
export const createApplicationVisibility = (
  account: string,
  communityAddress: string,
  storage: Storage | undefined = getStorage(),
) => {
  const key = `budabit/hidden-applications:v1:${account}:${encodeURIComponent(communityAddress)}`
  const applicationPrefix = `${key}:application:`
  const enabled = eventIdPattern.test(account) && Boolean(communityAddress)
  const read = (): Set<string> => {
    if (!enabled) return new Set()
    if (!storage) throw new Error(readError)
    const raw = storage.getItem(key)
    const hiddenIds = new Set<string>()
    // Read-only compatibility with the unreleased scope-wide record. Per-ID
    // overrides (including explicit restores) take precedence; never migrate by
    // rewriting this shared record, which could race a different tab's intent.
    if (raw !== null) {
      const parsed = JSON.parse(raw)
      if (
        parsed?.version !== 1 ||
        !Array.isArray(parsed.hidden) ||
        !parsed.hidden.every((id: unknown) => typeof id === "string" && eventIdPattern.test(id))
      )
        throw new Error(readError)
      for (const id of parsed.hidden) hiddenIds.add(id)
    }
    for (let index = 0; index < storage.length; index++) {
      const applicationKey = storage.key(index)
      if (!applicationKey?.startsWith(applicationPrefix)) continue
      const id = applicationKey.slice(applicationPrefix.length)
      if (!eventIdPattern.test(id)) continue
      const value = storage.getItem(applicationKey)
      if (value === null) continue
      const parsed = JSON.parse(value)
      if (parsed?.version !== 1 || typeof parsed.hidden !== "boolean") throw new Error(readError)
      if (parsed.hidden) hiddenIds.add(id)
      else hiddenIds.delete(id)
    }
    return hiddenIds
  }
  const refresh = () => {
    try {
      state.set({hiddenIds: read()})
    } catch {
      state.set({hiddenIds: new Set(), error: readError})
    }
  }
  const state = writable<Visibility>({hiddenIds: new Set()}, () => {
    refresh()
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null || event.key.startsWith(applicationPrefix))
        refresh()
    }
    if (typeof window !== "undefined") window.addEventListener("storage", onStorage)
    return () => {
      if (typeof window !== "undefined") window.removeEventListener("storage", onStorage)
    }
  })
  return {
    subscribe: state.subscribe,
    setHidden: (eventId: string, hidden: boolean) => {
      if (!enabled || !storage || !eventIdPattern.test(eventId)) {
        throw new Error("Application visibility could not be saved in this browser.")
      }
      // Each application's intent is its own atomic storage write, so concurrent
      // changes to different applications cannot overwrite one another. Explicit
      // false overrides also prevent legacy hidden entries from resurfacing.
      read()
      storage.setItem(`${applicationPrefix}${eventId}`, JSON.stringify({version: 1, hidden}))
      refresh()
    },
  }
}
