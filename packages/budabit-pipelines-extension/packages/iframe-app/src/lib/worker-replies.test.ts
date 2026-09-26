// @vitest-environment node
import {afterEach, describe, expect, it, vi} from 'vitest'
import {EMPTY, Subject} from 'rxjs'
import {finalizeEvent, generateSecretKey, getPublicKey} from 'nostr-tools'
import {buildRepoEvents, eventStore, pool} from './nostr'

vi.mock('applesauce-relay', async importOriginal => ({
  ...await importOriginal<typeof import('applesauce-relay')>(),
  RelayPool: class {subscription = vi.fn(); request = vi.fn()},
}))
vi.mock('applesauce-loaders/loaders', () => ({createEventLoaderForStore: () => () => EMPTY}))

afterEach(() => {vi.useRealTimers(); vi.clearAllMocks()})

describe('worker reply routing', () => {
  it('follows the selected worker outboxes while retaining job and author filters', async () => {
    vi.useFakeTimers()
    const key = generateSecretKey()
    const worker = getPublicKey(key)
    const runs = new Subject<any>()
    const jobs = new Subject<any>()
    vi.mocked(pool.subscription).mockImplementation((_relays, filter: any) => {
      if (filter.kinds[0] === 5401) return runs
      if (filter.kinds[0] === 5100) return jobs
      return EMPTY
    })
    const sub = buildRepoEvents('30617:owner:repo', ['wss://repo.example'], null).subscribe()
    runs.next({id: 'run', kind: 5401, pubkey: 'owner', tags: [['publisher', 'publisher']], created_at: 1, content: ''})
    jobs.next({id: 'job', kind: 5100, pubkey: 'owner', tags: [['p', worker], ['e', 'run']], created_at: 1, content: ''})
    const replyFilter = {kinds: [5101, 30100], authors: [worker], '#e': ['job']}
    expect(pool.subscription).toHaveBeenCalledWith(expect.arrayContaining(['wss://repo.example']), replyFilter)
    eventStore.add(finalizeEvent({kind: 10002, content: '', created_at: 1, tags: [
      ['r', 'wss://worker-outbox.test', 'write'], ['r', 'wss://worker-inbox.test', 'read'],
    ]}, key))
    await vi.advanceTimersByTimeAsync(300)
    const calls = vi.mocked(pool.subscription).mock.calls.filter(([, filter]: any) => filter.kinds[0] === 5101)
    const [relays, filter] = calls.at(-1)!
    expect(relays).toContain('wss://worker-outbox.test/')
    expect(relays).not.toContain('wss://worker-inbox.test/')
    expect(filter).toEqual(replyFilter)
    sub.unsubscribe()
    expect(runs.observed).toBe(false)
    expect(jobs.observed).toBe(false)
  })
})
