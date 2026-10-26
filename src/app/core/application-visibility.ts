import {writable} from "svelte/store"

type Visibility = {hiddenIds: Set<string>; error?: string}
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">
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
  const enabled = eventIdPattern.test(account) && Boolean(communityAddress)
  const read = (): Set<string> => {
    if (!enabled) return new Set()
    if (!storage) throw new Error(readError)
    const raw = storage.getItem(key)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.hidden) ||
      !parsed.hidden.every((id: unknown) => typeof id === "string" && eventIdPattern.test(id))
    ) {
      throw new Error(readError)
    }
    return new Set(parsed.hidden)
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
      if (event.key === key || event.key === null) refresh()
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
      // Re-read before writing to retain changes made by another tab. Never
      // overwrite an unreadable saved record with an empty default.
      const hiddenIds = read()
      if (hidden) hiddenIds.add(eventId)
      else hiddenIds.delete(eventId)
      storage.setItem(key, JSON.stringify({version: 1, hidden: [...hiddenIds]}))
      state.set({hiddenIds})
    },
  }
}
