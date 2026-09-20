import {pubkey, repository} from "@welshman/app"
import type {TrustedEvent} from "@welshman/util"
import {get} from "svelte/store"
import {activeCommunityPermissionStatus} from "@app/core/community-state"

// Feed signed fixture evidence into the real host stores without relay publication.
export const receiveFreelanceFixtureEvents = (events: TrustedEvent[]) => {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  for (const event of events) repository.publish(event)
}

export const switchFreelanceFixtureAccount = (account: string) => {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  pubkey.set(account || undefined)
}

let restoreAuthority: (() => void) | undefined
export const setFreelanceFixtureAuthorityPending = (pending: boolean) => {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  if (pending) {
    const settled = get(activeCommunityPermissionStatus)
    restoreAuthority = () => activeCommunityPermissionStatus.set(settled)
    activeCommunityPermissionStatus.set({
      ...settled,
      loading: true,
      loaded: false,
      complete: false,
      hasCachedEvents: false,
    })
  } else {
    restoreAuthority?.()
    restoreAuthority = undefined
  }
}
