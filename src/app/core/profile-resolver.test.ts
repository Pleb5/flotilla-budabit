import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => {
  const createStore = <T>(initial: T) => {
    let value = initial
    const subscribers = new Set<(value: T) => void>()

    return {
      subscribe: (run: (value: T) => void) => {
        subscribers.add(run)
        run(value)
        return () => subscribers.delete(run)
      },
      set: (next: T) => {
        value = next
        for (const run of subscribers) run(value)
      },
    }
  }

  return {
    profilesByPubkey: createStore(new Map<string, any>()),
    activeCommunityRelays: createStore([] as string[]),
    loadProfile: vi.fn(),
    forceLoadProfile: vi.fn(),
  }
})

vi.mock("@welshman/app", () => ({
  profilesByPubkey: mocks.profilesByPubkey,
  deriveProfile: (pubkey: string, ...args: any[]) => {
    mocks.loadProfile(pubkey, ...args)
    return {
      subscribe: (run: (profile: any) => void) =>
        mocks.profilesByPubkey.subscribe((profiles: Map<string, any>) => run(profiles.get(pubkey))),
    }
  },
  loadProfile: mocks.loadProfile,
  forceLoadProfile: mocks.forceLoadProfile,
}))

vi.mock("@app/core/state", () => ({
  INDEXER_RELAYS: ["wss://indexer.example"],
}))

vi.mock("@app/core/community-relays", () => ({
  activeUserCommunityRelays: mocks.activeCommunityRelays,
  getActiveUserCommunityRelays: () => ["wss://active.example"],
}))

const pubkey = "a".repeat(64)

describe("Budabit profile resolver", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.profilesByPubkey.set(new Map())
    mocks.activeCommunityRelays.set([])
    mocks.loadProfile.mockReset()
    mocks.forceLoadProfile.mockReset()
    mocks.loadProfile.mockResolvedValue(undefined)
    mocks.forceLoadProfile.mockResolvedValue(undefined)
  })

  it("normalizes profile relay hints without changing url semantics", async () => {
    const {getBudabitProfileRelays} = await import("./profile-resolver")

    expect(
      getBudabitProfileRelays(
        {
          url: "wss://hint.example",
          relays: ["wss://hint.example/", "not-a-relay"],
          communityRelays: ["wss://community.example"],
          includeActiveCommunityRelays: true,
        },
        ["wss://active.example", "wss://community.example/"],
      ),
    ).toEqual([
      "wss://indexer.example/",
      "wss://hint.example/",
      "wss://community.example/",
      "wss://active.example/",
    ])
  })

  it("uses Welshman loadProfile for the first missing-profile attempt", async () => {
    const {loadBudabitProfile} = await import("./profile-resolver")

    await loadBudabitProfile(pubkey, {url: "wss://hint.example"})

    expect(mocks.loadProfile).toHaveBeenCalledWith(pubkey, [
      "wss://indexer.example/",
      "wss://hint.example/",
    ])
    expect(mocks.forceLoadProfile).not.toHaveBeenCalled()
  })

  it("uses indexer-backed Welshman loadProfile for bare missing profiles", async () => {
    const {loadBudabitProfile} = await import("./profile-resolver")

    await expect(loadBudabitProfile(pubkey)).resolves.toBeUndefined()

    expect(mocks.loadProfile).toHaveBeenCalledWith(pubkey, ["wss://indexer.example/"])
    expect(mocks.forceLoadProfile).not.toHaveBeenCalled()
  })

  it("force-loads a missing profile when new relay hints appear", async () => {
    const {loadBudabitProfile} = await import("./profile-resolver")

    await loadBudabitProfile(pubkey, {url: "wss://hint.example"})
    await loadBudabitProfile(pubkey, {
      url: "wss://hint.example",
      relays: ["wss://new-hint.example"],
    })

    expect(mocks.forceLoadProfile).toHaveBeenCalledWith(pubkey, [
      "wss://indexer.example/",
      "wss://hint.example/",
      "wss://new-hint.example/",
    ])
  })

  it("does not reload when the profile is already present", async () => {
    const {loadBudabitProfile} = await import("./profile-resolver")
    const profile = {name: "Alice"}

    mocks.profilesByPubkey.set(new Map([[pubkey, profile]]))

    await expect(loadBudabitProfile(pubkey, {url: "wss://hint.example"})).resolves.toBe(profile)
    expect(mocks.loadProfile).not.toHaveBeenCalled()
    expect(mocks.forceLoadProfile).not.toHaveBeenCalled()
  })

  it("retries derived missing profiles when active community relays improve", async () => {
    const {deriveBudabitProfile} = await import("./profile-resolver")

    mocks.activeCommunityRelays.set(["wss://active.example"])
    const unsubscribe = deriveBudabitProfile(pubkey, {
      includeActiveCommunityRelays: true,
    }).subscribe(() => {})

    expect(mocks.loadProfile).toHaveBeenCalledWith(pubkey, [
      "wss://indexer.example/",
      "wss://active.example/",
    ])

    mocks.activeCommunityRelays.set(["wss://active.example", "wss://community.example"])

    expect(mocks.forceLoadProfile).toHaveBeenCalledWith(pubkey, [
      "wss://indexer.example/",
      "wss://active.example/",
      "wss://community.example/",
    ])

    unsubscribe()
  })

  it("updates display stores when a slow profile load arrives", async () => {
    const {deriveBudabitProfileDisplay} = await import("./profile-resolver")
    const values: string[] = []

    const unsubscribe = deriveBudabitProfileDisplay(pubkey).subscribe(value => values.push(value))

    expect(values.at(-1)).toBeTruthy()
    expect(values.at(-1)).not.toBe("Alice")

    mocks.profilesByPubkey.set(new Map([[pubkey, {name: "Alice"}]]))

    expect(values.at(-1)).toBe("Alice")

    unsubscribe()
  })
})
