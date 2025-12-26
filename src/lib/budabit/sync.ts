import {call} from "@welshman/lib"
import type { Unsubscriber } from "svelte/store"
 import {derived} from "svelte/store"
 import {identity} from "@welshman/lib"
 import {pubkey, shouldUnwrap} from "@welshman/app"
 import {GIT_RELAYS} from "./state"
 import {loadGraspServers, loadRepositories, loadTokens, setupBookmarksSync, setupGraspServersSync} from "./requests"

const syncUserGitData = () => {
    const unsubscribersByKey = new Map<string, Unsubscriber>()

    let currentPubkey: string | undefined

    const unsubscribeAll = () => {
        for (const [key, unsubscribe] of unsubscribersByKey.entries()) {
            unsubscribersByKey.delete(key)
            unsubscribe()
        }
    }

    const subscribeAll = (pk: string) => {
        if (!unsubscribersByKey.has("bookmarks")) {
            const unsub = setupBookmarksSync(pk, GIT_RELAYS)
            if (unsub) unsubscribersByKey.set("bookmarks", unsub)
        }

        if (!unsubscribersByKey.has("grasp")) {
            const unsub = setupGraspServersSync(pk, GIT_RELAYS)
            if (unsub) unsubscribersByKey.set("grasp", unsub)
        }

        loadRepositories(pk, GIT_RELAYS)
        loadGraspServers(pk, GIT_RELAYS)
        loadTokens(pk, GIT_RELAYS)
    }

    const unsubscribePubkey = derived([pubkey, shouldUnwrap], identity).subscribe(([$pubkey, $shouldUnwrap]) => {
        if ($pubkey !== currentPubkey) {
            unsubscribeAll()
        }

        if ($pubkey && $shouldUnwrap) {
            subscribeAll($pubkey)
        }

        currentPubkey = $pubkey
    })

    return () => {
        unsubscribeAll()
        unsubscribePubkey()
    }
}

export const syncBudabitData = () => {
    const unsubscribers = [syncUserGitData()]

    return () => unsubscribers.forEach(call)
}