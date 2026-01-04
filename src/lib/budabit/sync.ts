import {call, identity, sleep} from "@welshman/lib"
import type {Unsubscriber} from "svelte/store"
import {derived} from "svelte/store"
import {Router} from "@welshman/router"
import {pubkey, shouldUnwrap} from "@welshman/app"
import {GIT_RELAYS} from "./state"
import {
  loadGraspServers,
  loadRepositories,
  loadTokens,
  setupBookmarksSync,
  setupGraspServersSync,
} from "./requests"

const syncUserGitData = () => {
    const unsubscribersByKey = new Map<string, Unsubscriber>()

    let currentPubkey: string | undefined
    let loadController: AbortController | undefined
    const router = Router.get()

    const unsubscribeAll = () => {
        for (const [key, unsubscribe] of unsubscribersByKey.entries()) {
            unsubscribersByKey.delete(key)
            unsubscribe()
        }
    }

    const subscribeAll = (pk: string, relays: string[]) => {
        const mergedRelays = relays.length > 0 ? relays : GIT_RELAYS

        if (!unsubscribersByKey.has("bookmarks")) {
            const unsub = setupBookmarksSync(pk, mergedRelays)
            if (unsub) unsubscribersByKey.set("bookmarks", unsub)
        }

        if (!unsubscribersByKey.has("grasp")) {
            const unsub = setupGraspServersSync(pk, mergedRelays)
            if (unsub) unsubscribersByKey.set("grasp", unsub)
        }

        loadRepositories(pk, mergedRelays)
        loadGraspServers(pk, mergedRelays)
        loadTokens(pk, mergedRelays)
    }

    const ensureNotAborted = (signal: AbortSignal) => {
        if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError")
        }
    }

    const resolveUserRelays = async (signal: AbortSignal) => {
        const baseRelays = () => router.FromUser().getUrls()

        let userRelays = baseRelays()

        if (userRelays.length === 0) {
            for (let i = 0; i < 20; i++) {
                await sleep(100)
                ensureNotAborted(signal)
                userRelays = baseRelays()
                if (userRelays.length > 0) {
                    break
                }
            }
        }

        return userRelays
    }

    const unsubscribePubkey = derived([pubkey, shouldUnwrap], identity).subscribe(([$pubkey, $shouldUnwrap]) => {
        if ($pubkey !== currentPubkey) {
            unsubscribeAll()
        }

        loadController?.abort()

        if ($pubkey && $shouldUnwrap) {
            const controller = new AbortController()
            loadController = controller

            void (async () => {
                try {
                    ensureNotAborted(controller.signal)
                    const resolvedRelays = await resolveUserRelays(controller.signal)
                    ensureNotAborted(controller.signal)
                    subscribeAll($pubkey, resolvedRelays)
                } catch (error) {
                    if (error instanceof DOMException && error.name === "AbortError") {
                        return
                    }

                    console.warn("Failed to load user git data:", error)
                }
            })()
        }

        currentPubkey = $pubkey
    })

    return () => {
        unsubscribeAll()
        unsubscribePubkey()
        loadController?.abort()
    }
}

export const syncBudabitData = () => {
    const unsubscribers = [syncUserGitData()]

    return () => unsubscribers.forEach(call)
}