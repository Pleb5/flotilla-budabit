import {afterEach, describe, expect, it, vi} from 'vitest'
import {Subject, firstValueFrom, filter} from 'rxjs'
import {nip19} from 'nostr-tools'
import {buildWorkerEvents, pool} from './nostr'
import {externalUrlForEvent, parseLoomWorker, workers$} from './workflows'
import {workerAdmission, workerSubmissionBlock} from './submission'
import type {LoomWorker, NostrEvent} from './types'

vi.mock('./nostr', () => ({
  buildWorkerEvents: vi.fn(), pool: {request: vi.fn()},
  eventStore: {add: vi.fn()}, WORKER_ONLINE_WINDOW_MS: 300_000,
}))

const user = 'a'.repeat(64)
const workerKey = 'b'.repeat(64)
const address = nip19.naddrEncode({kind: 30000, pubkey: workerKey, identifier: 'access', relays: ['wss://list.example']})
const ad = (tags: string[][] = [], content = {name: 'Restricted worker', is_whitelisted: true}): NostrEvent => ({
  id: 'c'.repeat(64), pubkey: workerKey, kind: 10100, created_at: Math.floor(Date.now() / 1000),
  tags, content: JSON.stringify(content),
})
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks()})

describe('worker access before payment', () => {
  it('parses the admission gate from tags or content with tag precedence', () => {
    expect(parseLoomWorker(ad())?.requiresWhitelist).toBe(true)
    expect(parseLoomWorker(ad([['is_whitelisted', 'false']]))?.requiresWhitelist).toBe(false)
    expect(parseLoomWorker(ad([['whitelist_event', address]]))?.whitelistEventAddress).toBe(address)
  })

  it('allows freelist members, blocks known denial/loading, and preserves private-list uncertainty', () => {
    const worker = parseLoomWorker(ad())!
    expect(workerAdmission(worker)).toBe('unknown')
    expect(workerSubmissionBlock(worker)).toBeNull()
    expect(workerAdmission({...worker, whitelistedForUser: true})).toBe('allowed')
    expect(workerSubmissionBlock({...worker, whitelistedForUser: false})).toContain('Payment does not grant access')
    expect(workerSubmissionBlock({...worker, whitelistPending: true})).toContain('Please wait')
    expect(workerAdmission({...worker, whitelistedForUser: false, freeForUser: true})).toBe('allowed')
    expect(workerAdmission({...worker, requiresWhitelist: false})).toBe('allowed')
  })

  it.each(['member', 'nonmember', 'missing'] as const)('hydrates public whitelist membership: %s', async membership => {
    vi.useFakeTimers()
    const ads = new Subject<NostrEvent>()
    const lists = new Subject<NostrEvent>()
    vi.mocked(buildWorkerEvents).mockReturnValue(ads)
    vi.mocked(pool.request).mockReturnValue(lists as ReturnType<typeof pool.request>)
    let workers: LoomWorker[] = []
    const stream = workers$([`wss://${membership}.example`], user)
    const sub = stream.subscribe(value => {workers = value})
    ads.next(ad([['whitelist_event', address]]))
    expect(workerAdmission(workers[0]!)).toBe('pending')
    expect(pool.request).toHaveBeenCalledWith(
      ['wss://list.example', `wss://${membership}.example`],
      {kinds: [30000], authors: [workerKey], '#d': ['access']},
    )
    const settled = firstValueFrom(stream.pipe(filter(value => value.length > 0 && !value[0]!.whitelistPending)))
    if (membership !== 'missing') lists.next({...ad(), kind: 30000, tags: membership === 'member' ? [['p', user]] : []})
    lists.complete()
    await settled
    expect(workerAdmission(workers[0]!)).toBe({member: 'allowed', nonmember: 'denied', missing: 'unknown'}[membership])
    sub.unsubscribe()
    ads.complete()
  })
})

it('only exposes HTTP output links, never inline output or executable URLs', () => {
  expect(externalUrlForEvent(ad([['stdout', 'hello world']]))).toBeUndefined()
  expect(externalUrlForEvent(ad([['url', 'javascript:alert(1)']]))).toBeUndefined()
  expect(externalUrlForEvent(ad([['stdout', 'https://logs.example/output.txt']]))).toBe('https://logs.example/output.txt')
})
