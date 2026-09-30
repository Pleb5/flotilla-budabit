import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {getAddress, type TrustedEvent} from "@welshman/util"
import type {DeletionDemand} from "./deletion-hydration"
import type {DeletionRecord} from "./deletion-cache"
import type {FiniteRelayRequestOptions} from "./finite-relay-request"

const {records, storage} = vi.hoisted(() => {
  const records = new Map<string, DeletionRecord>()
  return {
    records,
    storage: {
      get: vi.fn(async (keys: string[]) => keys.flatMap(key => records.get(key) || [])),
      put: vi.fn(async (values: DeletionRecord[]) => {
        for (const record of values) records.set(record.key, {...record})
      }),
      clear: vi.fn(async () => records.clear()),
    },
  }
})
vi.mock("@welshman/app", async () => {
  const {Repository} = await import("@welshman/net")
  return {repository: new Repository(), tracker: {addRelay: vi.fn()}}
})
vi.mock("./deletion-cache", async importOriginal => ({
  ...(await importOriginal<typeof import("./deletion-cache")>()),
  createDeletionStorage: () => storage,
}))
vi.mock("./finite-relay-request", () => ({
  requestFiniteRelay: vi.fn(async (options: FiniteRelayRequestOptions) => ({
    relay: options.relay,
    outcome: "eose",
    events: [],
    queuedAt: 0,
    finishedAt: 0,
  })),
}))
vi.mock("./relay-policy", () => ({
  getRelayPolicy: () => ({maxLimit: 200}),
  RELAY_AUTH_SIGN_TIMEOUT: 90_000,
  RELAY_AUTH_ACK_TIMEOUT: 10_000,
}))

const demand: DeletionDemand = {
  scope: "account:community",
  navigation: "/threads",
  relays: ["wss://review.test/"],
  filters: [{kinds: [5], "#h": ["community"]}],
}
const target: TrustedEvent = {
  id: "1".repeat(64),
  pubkey: "a".repeat(64),
  kind: 11,
  created_at: 10,
  tags: [
    ["h", "community"],
    ["d", "calendar"],
  ],
  content: "cached",
  sig: "",
}
const makeDeletion = (event: TrustedEvent): TrustedEvent => ({
  ...event,
  id: "2".repeat(64),
  kind: 5,
  created_at: 11,
  tags: [[event.kind === 11 ? "e" : "a", event.kind === 11 ? event.id : getAddress(event)]],
})
let runtime: typeof import("./foreground-deletions")
let repository: typeof import("@welshman/app").repository
const releases: (() => void)[] = []
const register = (targets?: TrustedEvent[]) => {
  const registration = runtime.registerForegroundDeletions({...demand, targets})
  releases.push(registration.release)
  return registration
}
const restart = async () => {
  releases.splice(0).forEach(release => release())
  vi.resetModules()
  runtime = await import("./foreground-deletions")
  ;({repository} = await import("@welshman/app"))
  repository.clear()
}
beforeEach(async () => {
  vi.useFakeTimers()
  records.clear()
  vi.clearAllMocks()
  await restart()
})
afterEach(async () => {
  releases.splice(0).forEach(release => release())
  await runtime.clearDeletionCache()
  vi.useRealTimers()
})

describe("foreground deletion persistence arrival orders", () => {
  for (const kind of [11, 31923]) {
    it.each(["target-first", "delete-first", "before-registration"])(
      `${kind}: persists %s evidence across restart`,
      async order => {
        const event = {...target, kind}
        const deletion = makeDeletion(event)
        const registration = order === "before-registration" ? undefined : register()
        if (order === "target-first") repository.publish(event)
        repository.publish(deletion)
        repository.publish(event)
        if (registration) registration.update({...demand, targets: [event]})
        else register([event])
        expect(repository.isDeleted(event)).toBe(true)
        await vi.advanceTimersByTimeAsync(1100)
        expect(records.size).toBe(1)
        expect(storage.put).toHaveBeenCalledTimes(1)

        await restart()
        repository.publish(event)
        register([event])
        await vi.advanceTimersByTimeAsync(100)
        expect(repository.isDeleted(event)).toBe(true)
        await vi.advanceTimersByTimeAsync(1000)
        expect(storage.put).toHaveBeenCalledTimes(1)
        if (kind === 31923) {
          const newer = {...event, id: "3".repeat(64), created_at: 12}
          repository.publish(newer)
          expect(repository.query([{kinds: [kind]}])).toEqual([newer])
        }
      },
    )
  }

  it("remembers a hidden late target during scoped hydration without needing visible target demand", async () => {
    register()
    repository.publish(makeDeletion(target))
    expect(storage.put).not.toHaveBeenCalled()
    repository.publish(target)
    await vi.advanceTimersByTimeAsync(1100)
    expect(repository.isDeleted(target)).toBe(true)
    expect(records.size).toBe(1)
  })

  it("does not scan an archive or persist foreign-author evidence on registration", async () => {
    repository.publish({...makeDeletion(target), pubkey: "b".repeat(64)})
    repository.publish(target)
    expect(storage.get).not.toHaveBeenCalled()
    expect(storage.put).not.toHaveBeenCalled()
    register([target])
    await vi.advanceTimersByTimeAsync(1100)
    expect(repository.isDeleted(target)).toBe(false)
    expect(records.size).toBe(0)
    expect(storage.get).toHaveBeenCalledWith([`${target.id}:${target.pubkey}`])
  })
})
