import {call, identity, sleep} from "@welshman/lib"
import type {Unsubscriber} from "svelte/store"
import {derived} from "svelte/store"
import {Router} from "@welshman/router"
import {pubkey} from "@welshman/app"
import {GIT_RELAYS} from "./state"
import {
  loadGraspServers,
  loadRepositories,
  loadTokens,
  setupBookmarksSync,
  setupGraspServersSync,
  setupTokensSync,
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
        console.log("[syncUserGitData] subscribeAll called with pk:", pk, "relays:", relays, "mergedRelays:", mergedRelays)

        if (!unsubscribersByKey.has("bookmarks")) {
            console.log("[syncUserGitData] Setting up bookmarks sync...")
            const unsub = setupBookmarksSync(pk, mergedRelays)
            if (unsub) unsubscribersByKey.set("bookmarks", unsub)
            console.log("[syncUserGitData] Bookmarks sync setup complete")
        }

        if (!unsubscribersByKey.has("grasp")) {
            const unsub = setupGraspServersSync(pk, mergedRelays)
            if (unsub) unsubscribersByKey.set("grasp", unsub)
        }

        if (!unsubscribersByKey.has("tokens")) {
            console.log("[syncUserGitData] Setting up tokens sync...")
            const unsub = setupTokensSync(pk, mergedRelays)
            if (unsub) unsubscribersByKey.set("tokens", unsub)
            console.log("[syncUserGitData] Tokens sync setup complete")
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

    // Subscribe to pubkey changes only - bookmarks and git data are public, don't need shouldUnwrap
    const unsubscribePubkey = pubkey.subscribe(($pubkey) => {
        console.log("[syncUserGitData] Subscription fired - pubkey:", $pubkey, "currentPubkey:", currentPubkey)
        
        if ($pubkey !== currentPubkey) {
            unsubscribeAll()
        }

        loadController?.abort()

        if ($pubkey) {
            const controller = new AbortController()
            loadController = controller

            void (async () => {
                try {
                    ensureNotAborted(controller.signal)
                    console.log("[syncUserGitData] Resolving user relays...")
                    const resolvedRelays = await resolveUserRelays(controller.signal)
                    console.log("[syncUserGitData] Resolved relays:", resolvedRelays)
                    ensureNotAborted(controller.signal)
                    subscribeAll($pubkey, resolvedRelays)
                } catch (error) {
                    if (error instanceof DOMException && error.name === "AbortError") {
                        return
                    }

                    console.warn("Failed to load user git data:", error)
                }
            })()
        } else {
            console.log("[syncUserGitData] Skipping sync - no pubkey")
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