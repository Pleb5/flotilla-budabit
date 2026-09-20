import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import type {CommunityWidgetContext} from "./types"

const mocks = vi.hoisted(() => {
  let value = new Map<string, any>()
  const listeners = new Set<(value: Map<string, any>) => void>()
  return {
    load: vi.fn(),
    profiles: {
      subscribe(run: (value: Map<string, any>) => void) {
        listeners.add(run)
        run(value)
        return () => listeners.delete(run)
      },
      set(next: Map<string, any>) {
        value = next
        for (const run of listeners) run(value)
      },
    },
  }
})
vi.mock("@welshman/app", () => ({profilesByPubkey: mocks.profiles}))
vi.mock("@app/core/profile-resolver", () => ({
  loadBudabitProfile: mocks.load,
  PROFILE_BATCH_CONCURRENCY: 3,
}))
import {ExtensionProfileResolver} from "./profiles"

const key = "a".repeat(64)
const other = "b".repeat(64)
const context = {
  definitionAddress: "32222:owner:community",
  contextSessionId: "session",
  contextVersion: 1,
  viewer: {},
  relays: ["wss://community.example"],
} as CommunityWidgetContext
const request = {requestId: "one", pubkeys: [key], contextSessionId: "session", contextVersion: 1}
const instances: ExtensionProfileResolver[] = []
const setup = (getContext = () => context) => {
  const post = vi.fn()
  const resolver = new ExtensionProfileResolver(getContext, post)
  instances.push(resolver)
  return {resolver, post}
}
beforeEach(() => {
  mocks.profiles.set(new Map())
  mocks.load.mockReset()
  mocks.load.mockResolvedValue(undefined)
})
afterEach(() => {
  instances.splice(0).forEach(instance => instance.close())
  vi.useRealTimers()
})

describe("widget profile adapter", () => {
  it("returns shared cached profiles immediately without a relay load and observes subsequent changes", () => {
    mocks.profiles.set(
      new Map([[key, {display_name: "Cached", picture: "https://images.example/avatar.png"}]]),
    )
    const {resolver, post} = setup()
    expect(resolver.resolve({...request, pubkeys: [key, key]})).toMatchObject({
      revision: 0,
      profiles: [{pubkey: key, status: "ready", profile: {display_name: "Cached"}}],
    })
    expect(mocks.load).not.toHaveBeenCalled()
    mocks.profiles.set(new Map([[key, {name: "Updated"}]]))
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        revision: 1,
        profiles: [
          {
            pubkey: key,
            status: "ready",
            profile: {pubkey: key, name: "Updated", display_name: "", picture: ""},
          },
        ],
      }),
    )
    mocks.profiles.set(
      new Map([
        [key, {name: "Updated"}],
        [other, {name: "Unrelated"}],
      ]),
    )
    expect(post).toHaveBeenCalledTimes(1)
  })

  it("passes community hints through the existing resolver and bounds fallback while accepting late profiles", async () => {
    vi.useFakeTimers()
    mocks.load.mockReturnValue(new Promise(() => {}))
    const {resolver, post} = setup()
    expect(resolver.resolve(request).profiles[0].status).toBe("loading")
    expect(mocks.load).toHaveBeenCalledWith(key, {communityRelays: context.relays})
    await vi.advanceTimersByTimeAsync(5000)
    expect(post.mock.lastCall?.[0].profiles[0].status).toBe("unavailable")
    mocks.profiles.set(new Map([[key, {display_name: "Late profile"}]]))
    expect(post.mock.lastCall?.[0].profiles[0]).toMatchObject({
      status: "ready",
      profile: {display_name: "Late profile"},
    })
  })

  it("reports misses without an error and stops observing removed pubkeys", async () => {
    const {resolver, post} = setup()
    resolver.resolve(request)
    await Promise.resolve()
    expect(post.mock.lastCall?.[0].profiles[0].status).toBe("unavailable")
    resolver.resolve({...request, requestId: "two", pubkeys: []})
    post.mockClear()
    mocks.profiles.set(new Map([[key, {name: "Old request"}]]))
    expect(post).not.toHaveBeenCalled()
  })

  it("discards stale loads on context change and detach without altering shared loads", async () => {
    let complete!: () => void
    mocks.load.mockReturnValue(
      new Promise<void>(resolve => {
        complete = resolve
      }),
    )
    let current = context
    const {resolver, post} = setup(() => current)
    resolver.resolve(request)
    current = {...context, contextVersion: 2}
    resolver.contextChanged()
    complete()
    await Promise.resolve()
    mocks.profiles.set(new Map([[key, {name: "Wrong context"}]]))
    expect(post).not.toHaveBeenCalled()
    resolver.resolve({...request, contextVersion: 2})
    resolver.close()
    mocks.profiles.set(new Map([[key, {name: "After detach"}]]))
    expect(post).not.toHaveBeenCalled()
  })

  it("validates request bounds and exact context before starting discovery", () => {
    const {resolver} = setup()
    for (const payload of [
      {...request, pubkeys: ["bad"]},
      {...request, pubkeys: Array(513).fill(key)},
      {...request, requestId: ""},
      {...request, contextVersion: 0},
    ])
      expect(() => resolver.resolve(payload)).toThrow()
    expect(mocks.load).not.toHaveBeenCalled()
  })
})
