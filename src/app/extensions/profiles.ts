import {profilesByPubkey} from "@welshman/app"
import {loadBudabitProfile, PROFILE_BATCH_CONCURRENCY} from "@app/core/profile-resolver"
import {get} from "svelte/store"
import {MAX_WIDGET_PROFILE_PUBKEYS} from "./host-capabilities"
import type {
  CommunityWidgetContext,
  ProfilesResolveRequest,
  ProfilesResolveResponse,
  WidgetProfileResult,
} from "./types"

const LOOKUP_WINDOW_MS = 5_000
const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : ""
const contextKey = (context?: CommunityWidgetContext) =>
  JSON.stringify([
    context?.definitionAddress,
    context?.viewer.pubkey,
    context?.contextSessionId,
    context?.contextVersion,
    context?.relays,
  ])

/** Iframe adapter only: the existing resolver owns caching, deduplication and relay policy. */
export class ExtensionProfileResolver {
  private generation = 0
  private stop?: () => void
  private timer?: ReturnType<typeof setTimeout>
  private scopeKey = ""

  constructor(
    private context: () => CommunityWidgetContext | undefined,
    private post: (result: ProfilesResolveResponse) => void,
  ) {}

  contextChanged() {
    if (this.scopeKey !== contextKey(this.context())) this.close()
  }

  resolve(payload: ProfilesResolveRequest): ProfilesResolveResponse {
    if (
      !payload ||
      typeof payload.requestId !== "string" ||
      !payload.requestId ||
      payload.requestId.length > 128 ||
      !Array.isArray(payload.pubkeys) ||
      payload.pubkeys.length > MAX_WIDGET_PROFILE_PUBKEYS ||
      payload.pubkeys.some(pubkey => typeof pubkey !== "string" || !/^[0-9a-f]{64}$/.test(pubkey))
    )
      throw new Error("Invalid profile request: provide a requestId and up to 512 hex pubkeys")
    const context = this.context()
    if (
      context &&
      (payload.contextSessionId !== context.contextSessionId ||
        payload.contextVersion !== context.contextVersion)
    ) {
      throw new Error("Community context changed before profile lookup")
    }
    this.close()
    this.scopeKey = contextKey(context)
    const generation = this.generation
    const current = () =>
      generation === this.generation && this.scopeKey === contextKey(this.context())
    const pubkeys = [...new Set(payload.pubkeys)]
    const pending = new Set(pubkeys)
    let revision = 0
    const snapshot = (): ProfilesResolveResponse => {
      const cached = get(profilesByPubkey)
      return {
        status: "ok",
        requestId: payload.requestId,
        revision,
        profiles: pubkeys.map((pubkey): WidgetProfileResult => {
          const value = cached.get(pubkey)
          const profile = {
            pubkey,
            display_name: text(value?.display_name, 120),
            name: text(value?.name, 120),
            picture: text(value?.picture, 2048),
          }
          return profile.display_name || profile.name || profile.picture
            ? {pubkey, status: "ready", profile}
            : {pubkey, status: pending.has(pubkey) ? "loading" : "unavailable"}
        }),
      }
    }
    const initial = snapshot()
    for (const item of initial.profiles) if (item.status === "ready") pending.delete(item.pubkey)
    let previous = JSON.stringify(initial.profiles)
    const notify = () => {
      if (!current()) return
      const next = snapshot()
      const serialized = JSON.stringify(next.profiles)
      if (serialized === previous) return
      previous = serialized
      next.revision = ++revision
      this.post(next)
    }
    // Keep observing the existing store after the bounded loading UI settles, so
    // profiles found by another host surface (or a slow relay) hydrate the iframe.
    if (pubkeys.length) this.stop = profilesByPubkey.subscribe(notify)
    if (pending.size) {
      this.timer = setTimeout(() => {
        pending.clear()
        notify()
      }, LOOKUP_WINDOW_MS)
      const missing = [...pending]
      let index = 0
      const worker = async () => {
        while (current()) {
          const pubkey = missing[index++]
          if (!pubkey) return
          try {
            await loadBudabitProfile(pubkey, {communityRelays: context?.relays || []})
          } catch {
            /* An unavailable profile is a display fallback, not a workflow failure. */
          }
          if (!current()) return
          pending.delete(pubkey)
          notify()
        }
      }
      for (let i = 0; i < Math.min(PROFILE_BATCH_CONCURRENCY, missing.length); i++) void worker()
    }
    return initial
  }

  close() {
    this.generation++
    this.stop?.()
    this.stop = undefined
    clearTimeout(this.timer)
    this.timer = undefined
  }
}
