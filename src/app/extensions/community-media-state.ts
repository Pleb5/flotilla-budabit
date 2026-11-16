import type {CommunityWidgetContext} from "./types"

export type MediaContextIdentity = Pick<
  CommunityWidgetContext,
  "definitionAddress" | "contextSessionId" | "contextVersion" | "viewer"
>
export type CommunityMediaState = {
  status: "ok"
  callActive: boolean
  broadcastPrepared: boolean
  revision: number
  contextSessionId: string
  contextVersion: number
}
type Entry = {
  context: MediaContextIdentity
  scope: string
  callActive: boolean
  notify?: (state: CommunityMediaState) => void
}

/** Ephemeral call presence and tab-local broadcast intent. Never an OBS status API. */
export class CommunityMediaCoordinator {
  private entries = new Map<object, Entry>()
  private revision = 0
  private broadcasts = new Map<string, boolean>()
  private scope(context: MediaContextIdentity) {
    return JSON.stringify([context.definitionAddress, context.viewer.pubkey || ""])
  }
  private storageKey(scope: string) {
    return `budabit:broadcast-preview:${scope}`
  }
  private broadcast(scope: string) {
    if (!this.broadcasts.has(scope)) {
      let saved = false
      try {
        saved = sessionStorage.getItem(this.storageKey(scope)) === "prepared"
      } catch {}
      this.broadcasts.set(scope, saved)
    }
    return this.broadcasts.get(scope) === true
  }
  private entry(owner: object, context: MediaContextIdentity): Entry {
    const previous = this.entries.get(owner)
    const scope = this.scope(context)
    if (
      previous &&
      previous.scope === scope &&
      previous.context.contextSessionId === context.contextSessionId &&
      previous.context.contextVersion === context.contextVersion
    )
      return previous
    this.remove(owner)
    const entry: Entry = {
      context: {...context, viewer: {...context.viewer}},
      scope,
      callActive: false,
    }
    this.entries.set(owner, entry)
    return entry
  }
  private snapshot(context: MediaContextIdentity): CommunityMediaState {
    const scope = this.scope(context)
    return {
      status: "ok",
      callActive: [...this.entries.values()].some(
        entry => entry.scope === scope && entry.callActive,
      ),
      broadcastPrepared: this.broadcast(scope),
      revision: this.revision,
      contextSessionId: context.contextSessionId,
      contextVersion: context.contextVersion,
    }
  }
  private changed(scope: string) {
    this.revision++
    for (const entry of this.entries.values()) {
      if (entry.scope === scope) entry.notify?.(this.snapshot(entry.context))
    }
  }
  watch(owner: object, context: MediaContextIdentity, notify: Entry["notify"]) {
    this.entry(owner, context).notify = notify
    return this.snapshot(context)
  }
  set(
    owner: object,
    context: MediaContextIdentity,
    activity: "call" | "broadcast",
    active: boolean,
  ) {
    const entry = this.entry(owner, context)
    if (activity === "call") {
      if (entry.callActive !== active) {
        entry.callActive = active
        this.changed(entry.scope)
      }
    } else if (this.broadcast(entry.scope) !== active) {
      this.broadcasts.set(entry.scope, active)
      try {
        if (active) sessionStorage.setItem(this.storageKey(entry.scope), "prepared")
        else sessionStorage.removeItem(this.storageKey(entry.scope))
      } catch {}
      this.changed(entry.scope)
    }
    return this.snapshot(context)
  }
  remove(owner: object) {
    const entry = this.entries.get(owner)
    if (!entry) return
    this.entries.delete(owner)
    // Removing a widget stops its call, but cannot stop an external OBS output.
    if (entry.callActive) this.changed(entry.scope)
  }
}

export const communityMediaCoordinator = new CommunityMediaCoordinator()
