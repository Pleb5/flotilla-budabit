import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {EMPTY, Subject, of, throwError} from 'rxjs'
import {finalizeEvent, generateSecretKey, getPublicKey} from 'nostr-tools'
import {eventStore, pool} from './nostr'
import {resolveWorkerDeliveryRelays, WORKER_RELAY_LOOKUP_MS} from './worker-routing'

vi.mock('./nostr', () => ({
  eventStore: {getReplaceable: vi.fn(), add: vi.fn()}, pool: {request: vi.fn()},
  PROFILE_LOOKUP_RELAYS: ['wss://indexer.example'],
  LOOM_WORKER_RELAYS: ['wss://default.example', 'wss://repo.example/'],
}))

const key = generateSecretKey()
const worker = getPublicKey(key)
const list = (tags: string[][], created_at = 100) => finalizeEvent({kind: 10002, content: '', tags, created_at}, key)
const repo = ['wss://repo.example/', 'wss://repo.example', 'https://invalid.example']
const fallback = ['wss://repo.example', 'wss://default.example']
beforeEach(() => {vi.mocked(eventStore.getReplaceable).mockReturnValue(undefined)})
afterEach(() => {vi.clearAllMocks(); vi.useRealTimers()})

describe('worker job delivery', () => {
  it('routes to the newest signed worker inbox list, excluding write-only and invalid hints', async () => {
    const older = list([['r', 'wss://old-inbox.example']], 90)
    const newest = list([
      ['r', 'wss://inbox.example/', 'read'], ['r', 'wss://both.example'],
      ['r', 'wss://outbox-only.example', 'write'], ['r', 'javascript:bad'],
      ['r', 'wss://user:password@private.example'], ['r', 'wss://inbox.example'],
    ])
    vi.mocked(pool.request).mockReturnValue(of(newest, older))
    expect(await resolveWorkerDeliveryRelays(worker, repo)).toEqual(['wss://inbox.example', 'wss://both.example', ...fallback])
    expect(pool.request).toHaveBeenCalledWith(expect.arrayContaining(['wss://indexer.example']), {kinds: [10002], authors: [worker]})
    expect(eventStore.add).toHaveBeenCalledWith(newest)
  })

  it('keeps responses received before the deadline when another relay never finishes', async () => {
    vi.useFakeTimers()
    const events = new Subject<ReturnType<typeof list>>()
    vi.mocked(pool.request).mockReturnValue(events)
    const pending = resolveWorkerDeliveryRelays(worker, repo)
    events.next(list([['r', 'wss://inbox.example', 'read']]))
    await vi.advanceTimersByTimeAsync(WORKER_RELAY_LOOKUP_MS)
    expect(await pending).toEqual(['wss://inbox.example', ...fallback])
    expect(events.observed).toBe(false)
  })

  it('uses cached mailboxes during an outage and defaults when no mailbox is advertised', async () => {
    vi.mocked(pool.request).mockReturnValue(throwError(() => new Error('offline')))
    vi.mocked(eventStore.getReplaceable).mockReturnValue(list([['r', 'wss://cached.example', 'read']]))
    expect(await resolveWorkerDeliveryRelays(worker, repo)).toEqual(['wss://cached.example', ...fallback])
    vi.mocked(eventStore.getReplaceable).mockReturnValue(undefined)
    vi.mocked(pool.request).mockReturnValue(EMPTY)
    expect(await resolveWorkerDeliveryRelays(worker, repo)).toEqual(fallback)
  })

  it('ignores forged or unrelated mailbox events and honors a newer empty list', async () => {
    const valid = list([['r', 'wss://inbox.example']])
    // Simulate relay JSON, without nostr-tools' cached verified-symbol marker.
    const forged = {...JSON.parse(JSON.stringify(valid)), tags: [['r', 'wss://forged.example']]}
    const unrelated = finalizeEvent({kind: 10002, created_at: 200, content: '', tags: [['r', 'wss://other.example']]}, generateSecretKey())
    vi.mocked(pool.request).mockReturnValue(of(forged, unrelated))
    expect(await resolveWorkerDeliveryRelays(worker, repo)).toEqual(fallback)
    vi.mocked(eventStore.getReplaceable).mockReturnValue(valid)
    vi.mocked(pool.request).mockReturnValue(of(list([], 200)))
    expect(await resolveWorkerDeliveryRelays(worker, repo)).toEqual(fallback)
  })
})
