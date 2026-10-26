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
    request: vi.fn(),
    repository: {
      hasEvent: vi.fn(() => false),
      publish: vi.fn(),
    },
    tracker: {
      hasRelay: vi.fn(() => false),
      addRelay: vi.fn(),
    },
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
  repository: mocks.repository,
  tracker: mocks.tracker,
}))

vi.mock("@welshman/net", () => ({request: mocks.request}))

vi.mock("@app/core/state", () => ({
  INDEXER_RELAYS: ["wss://indexer.example"],
}))

vi.mock("@app/core/community-relays", () => ({
  activeUserCommunityRelays: mocks.activeCommunityRelays,
  getActiveUserCommunityRelays: () => ["wss://active.example"],
  getPubkeyOutboxRelays: () => ["wss://outbox.example"],
}))

const pubkey = "a".repeat(64)

describe("Budabit profile resolver", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.profilesByPubkey.set(new Map())
    mocks.activeCommunityRelays.set([])
    mocks.loadProfile.mockReset()
    mocks.forceLoadProfile.mockReset()
    mocks.request.mockReset()
    mocks.loadProfile.mockResolvedValue(undefined)
    mocks.forceLoadProfile.mockResolvedValue(undefined)
    mocks.request.mockResolvedValue([])
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

  it("loads explicit hints directly and keeps ambient discovery separate", async () => {
    const {loadBudabitProfile} = await import("./profile-resolver")

    await loadBudabitProfile(pubkey, {url: "wss://hint.example"})

    expect(mocks.loadProfile).toHaveBeenCalledWith(pubkey, [
      "wss://indexer.example/",
      "wss://outbox.example/",
    ])
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        relays: ["wss://hint.example/"],
        filters: [{kinds: [0], authors: [pubkey], limit: 1}],
        autoClose: true,
        lifetime: "finite",
      }),
    )
    expect(mocks.forceLoadProfile).not.toHaveBeenCalled()
  })

  it("preserves and bounds explicit hints in caller order", async () => {
    const {getBudabitExplicitProfileRelays, MAX_EXPLICIT_PROFILE_RELAYS} = await import(
      "./profile-resolver"
    )

    expect(
      getBudabitExplicitProfileRelays({
        url: "wss://first.example",
        relays: [
          "wss://second.example",
          "wss://third.example",
          "wss://fourth.example",
        ],
      }),
    ).toEqual(
      ["wss://first.example/", "wss://second.example/", "wss://third.example/"].slice(
        0,
        MAX_EXPLICIT_PROFILE_RELAYS,
      ),
    )
  })

  it("uses indexer-backed Welshman loadProfile for bare missing profiles", async () => {
    const {loadBudabitProfile} = await import("./profile-resolver")

    await expect(loadBudabitProfile(pubkey)).resolves.toBeUndefined()

    expect(mocks.loadProfile).toHaveBeenCalledWith(pubkey, [
      "wss://indexer.example/",
      "wss://outbox.example/",
    ])
    expect(mocks.forceLoadProfile).not.toHaveBeenCalled()
  })

  it("queries only newly introduced explicit hints", async () => {
    const {loadBudabitProfile} = await import("./profile-resolver")

    await loadBudabitProfile(pubkey, {url: "wss://hint.example"})
    await loadBudabitProfile(pubkey, {
      url: "wss://hint.example",
      relays: ["wss://new-hint.example"],
    })

    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(mocks.request.mock.calls[1][0]).toEqual(
      expect.objectContaining({relays: ["wss://new-hint.example/"]}),
    )
    expect(mocks.forceLoadProfile).not.toHaveBeenCalled()
  })

  it("adds fixed explicit hints without repeating ambient discovery", async () => {
    const {deriveBudabitProfile} = await import("./profile-resolver")

    const unsubscribeBare = deriveBudabitProfile(pubkey).subscribe(() => {})
    const unsubscribeHinted = deriveBudabitProfile(pubkey, {
      relays: ["wss://hint.example"],
    }).subscribe(() => {})

    expect(mocks.loadProfile).toHaveBeenCalledWith(pubkey, [
      "wss://indexer.example/",
      "wss://outbox.example/",
    ])
    expect(mocks.forceLoadProfile).not.toHaveBeenCalled()
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({relays: ["wss://hint.example/"]}),
    )

    unsubscribeBare()
    unsubscribeHinted()
  })

  it("deduplicates repeated missing-profile loads for the same relay set", async () => {
    const {loadBudabitProfile} = await import("./profile-resolver")

    await Promise.all([
      loadBudabitProfile(pubkey, {url: "wss://hint.example"}),
      loadBudabitProfile(pubkey, {url: "wss://hint.example"}),
    ])
    await loadBudabitProfile(pubkey, {url: "wss://hint.example"})

    expect(mocks.loadProfile).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.forceLoadProfile).not.toHaveBeenCalled()
  })

  it("returns a cached profile while refreshing a new explicit hint", async () => {
    const {loadBudabitProfile} = await import("./profile-resolver")
    const profile = {name: "Alice"}

    mocks.profilesByPubkey.set(new Map([[pubkey, profile]]))

    await expect(loadBudabitProfile(pubkey, {url: "wss://hint.example"})).resolves.toBe(profile)
    expect(mocks.loadProfile).not.toHaveBeenCalled()
    expect(mocks.forceLoadProfile).not.toHaveBeenCalled()
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({relays: ["wss://hint.example/"]}),
    )

    await loadBudabitProfile(pubkey, {url: "wss://hint.example"})
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it("retries sparse cached profiles when better relay hints arrive", async () => {
    const {loadBudabitProfile} = await import("./profile-resolver")

    mocks.profilesByPubkey.set(new Map([[pubkey, {}]]))

    await loadBudabitProfile(pubkey)
    await loadBudabitProfile(pubkey, {relays: ["wss://hint.example"]})

    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({relays: ["wss://hint.example/"]}),
    )
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
      "wss://outbox.example/",
    ])

    mocks.activeCommunityRelays.set(["wss://active.example", "wss://community.example"])

    expect(mocks.forceLoadProfile).toHaveBeenCalledWith(pubkey, [
      "wss://indexer.example/",
      "wss://active.example/",
      "wss://community.example/",
      "wss://outbox.example/",
    ])

    unsubscribe()
  })

  it("does not subscribe derived profiles to active relays unless requested", async () => {
    const {deriveBudabitProfile} = await import("./profile-resolver")

    const unsubscribe = deriveBudabitProfile(pubkey).subscribe(() => {})
    mocks.activeCommunityRelays.set(["wss://community.example"])

    expect(mocks.forceLoadProfile).not.toHaveBeenCalled()

    unsubscribe()
  })

  it("deduplicates batch pubkeys and groups equal relay scopes", async () => {
    const {buildBudabitProfileBatchPlan} = await import("./profile-resolver")
    const otherPubkey = "b".repeat(64)

    expect(
      buildBudabitProfileBatchPlan([
        {pubkey, relays: ["wss://one.example", "wss://two.example"]},
        {pubkey, relays: ["wss://two.example", "wss://one.example"]},
        {pubkey: otherPubkey, relays: ["wss://one.example", "wss://two.example"]},
      ]),
    ).toEqual([
      {
        pubkeys: [pubkey, otherPubkey],
        relays: ["wss://one.example/", "wss://two.example/"],
      },
    ])
  })

  it("bounds concurrent profile relay groups", async () => {
    const {loadBudabitProfileBatch, PROFILE_BATCH_CONCURRENCY} = await import("./profile-resolver")
    let active = 0
    let maxActive = 0
    const finishes: Array<() => void> = []
    const requestGroup = vi.fn(
      () =>
        new Promise<void>(resolve => {
          active += 1
          maxActive = Math.max(maxActive, active)
          finishes.push(() => {
            active -= 1
            resolve()
          })
        }),
    )
    const pending = loadBudabitProfileBatch(
      Array.from({length: PROFILE_BATCH_CONCURRENCY + 2}, (_, index) => ({
        pubkey: index.toString(16).padStart(64, "0"),
        relays: [`wss://relay-${index}.example`],
      })),
      undefined,
      {hasProfile: () => false, requestGroup},
    )

    await vi.waitFor(() => expect(requestGroup).toHaveBeenCalledTimes(PROFILE_BATCH_CONCURRENCY))
    while (finishes.length > 0) {
      finishes.shift()?.()
      await Promise.resolve()
    }
    await pending

    expect(maxActive).toBe(PROFILE_BATCH_CONCURRENCY)
  })

  it("stops profile batch scheduling after caller cancellation", async () => {
    const {loadBudabitProfileBatch} = await import("./profile-resolver")
    const controller = new AbortController()
    const requestGroup = vi.fn(async () => controller.abort())

    await expect(
      loadBudabitProfileBatch(
        Array.from({length: 5}, (_, index) => ({
          pubkey: (index + 10).toString(16).padStart(64, "0"),
          relays: [`wss://cancel-${index}.example`],
        })),
        controller.signal,
        {hasProfile: () => false, requestGroup},
      ),
    ).rejects.toMatchObject({name: "AbortError"})
    expect(requestGroup.mock.calls.length).toBeLessThanOrEqual(3)
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

  it.each(["empty", "failed"])(
    "retries %s explicit metadata reads after the cooldown",
    async outcome => {
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000)
      try {
        const {loadBudabitProfile} = await import("./profile-resolver")
        if (outcome === "failed") mocks.request.mockRejectedValueOnce(new Error("offline"))
        await loadBudabitProfile(pubkey, {relays: ["wss://community.example"]})
        await loadBudabitProfile(pubkey, {relays: ["wss://community.example"]})
        expect(mocks.request).toHaveBeenCalledTimes(1)
        clock.mockReturnValue(1_060_001)
        await loadBudabitProfile(pubkey, {relays: ["wss://community.example"]})
        expect(mocks.request).toHaveBeenCalledTimes(2)
      } finally {
        clock.mockRestore()
      }
    },
  )

  it("shares late exact-author metadata across groups and a newly opened modal", async () => {
    const {deriveBudabitProfile} = await import("./profile-resolver")
    const values: any[] = []
    const unsubscribers = [0, 1, 2].map(index =>
      deriveBudabitProfile(pubkey, {relays: ["wss://community.example"]}).subscribe(value => {
        values[index] = value
      }),
    )
    const profile = {name: "Same applicant", event: {pubkey}}
    mocks.profilesByPubkey.set(new Map([[pubkey, profile]]))
    unsubscribers.push(
      deriveBudabitProfile(pubkey).subscribe(value => {
        values[3] = value
      }),
    )
    expect(values).toEqual([profile, profile, profile, profile])
    expect(mocks.request).toHaveBeenCalledTimes(1)
    unsubscribers.forEach(unsubscribe => unsubscribe())
  })
})
