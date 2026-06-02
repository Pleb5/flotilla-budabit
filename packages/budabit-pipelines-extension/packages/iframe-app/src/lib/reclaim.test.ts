import {describe, it, expect} from 'vitest'
import {
  STALE_PENDING_MS,
  classifyReclaimError,
  getReclaimCandidate,
  type RedeemedMap,
} from './reclaim'
import type {NostrEvent, WorkflowRun, WorkflowStatus} from './types'

const USER = 'aabbcc' + 'dd'.repeat(28)
const OTHER = '11223344' + 'ff'.repeat(28)
const PAYMENT_TOKEN = 'cashuApayloadpayment'
const CHANGE_TOKEN = 'cashuBpayloadchange'

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  const base: WorkflowRun = {
    id: 'run1',
    name: 'workflow.yml',
    status: 'pending' as WorkflowStatus,
    branch: 'main',
    commit: 'deadbeef',
    commitMessage: 'msg',
    actor: USER,
    event: 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  return {...base, ...overrides}
}

function jobEventWithPayment(token = PAYMENT_TOKEN): NostrEvent {
  return {
    id: 'job1',
    pubkey: USER,
    created_at: 0,
    kind: 5100,
    content: '',
    tags: [['payment', token]],
  }
}

function resultEvent(tags: string[][]): NostrEvent {
  return {
    id: 'result1',
    pubkey: 'workerpk',
    created_at: 0,
    kind: 5101,
    content: '',
    tags,
  }
}

describe('getReclaimCandidate', () => {
  const empty: RedeemedMap = {}

  it('returns null when there is no logged-in user', () => {
    const run = makeRun({status: 'failure', loomJobEvent: jobEventWithPayment()})
    expect(getReclaimCandidate(run, undefined, empty)).toBeNull()
  })

  it('returns null for runs the user did not trigger', () => {
    const run = makeRun({
      actor: OTHER,
      status: 'failure',
      loomJobEvent: jobEventWithPayment(),
    })
    expect(getReclaimCandidate(run, USER, empty)).toBeNull()
  })

  it('returns null when the run is already in the redeemed log', () => {
    const run = makeRun({
      status: 'success',
      loomResultEvent: resultEvent([['change', CHANGE_TOKEN]]),
    })
    const redeemed: RedeemedMap = {
      [run.id]: {kind: 'change', tokenHash: 'h', redeemedAt: 0},
    }
    expect(getReclaimCandidate(run, USER, redeemed)).toBeNull()
  })

  it('prefers the change token when both are present', () => {
    const run = makeRun({
      status: 'success',
      loomJobEvent: jobEventWithPayment(),
      loomResultEvent: resultEvent([['change', CHANGE_TOKEN]]),
    })
    const candidate = getReclaimCandidate(run, USER, empty)
    expect(candidate).toEqual({runId: run.id, kind: 'change', token: CHANGE_TOKEN})
  })

  it('returns the original payment for a terminal failure with no result', () => {
    const run = makeRun({status: 'failure', loomJobEvent: jobEventWithPayment()})
    expect(getReclaimCandidate(run, USER, empty)).toEqual({
      runId: run.id,
      kind: 'original',
      token: PAYMENT_TOKEN,
    })
  })

  it('returns the original payment for a failure with a non-success result and no change', () => {
    const run = makeRun({
      status: 'failure',
      loomJobEvent: jobEventWithPayment(),
      loomResultEvent: resultEvent([
        ['success', 'false'],
        ['exit_code', '1'],
      ]),
      inferredFailure: true,
    })
    expect(getReclaimCandidate(run, USER, empty)).toEqual({
      runId: run.id,
      kind: 'original',
      token: PAYMENT_TOKEN,
    })
  })

  it('returns null when a successful result settled without change', () => {
    const run = makeRun({
      status: 'success',
      loomJobEvent: jobEventWithPayment(),
      loomResultEvent: resultEvent([['success', 'true']]),
    })
    expect(getReclaimCandidate(run, USER, empty)).toBeNull()
  })

  it('does not reclaim original payment when failure result still carries change', () => {
    const run = makeRun({
      status: 'failure',
      loomJobEvent: jobEventWithPayment(),
      loomResultEvent: resultEvent([
        ['success', 'false'],
        ['change', CHANGE_TOKEN],
      ]),
    })
    // Should fall through to the change branch — never returns 'original' here
    // because the worker already swapped the original.
    expect(getReclaimCandidate(run, USER, empty)).toEqual({
      runId: run.id,
      kind: 'change',
      token: CHANGE_TOKEN,
    })
  })

  it('treats stale-pending runs as reclaimable with the original payment', () => {
    const now = Date.now()
    const run = makeRun({
      status: 'pending',
      loomJobEvent: jobEventWithPayment(),
      createdAt: now - STALE_PENDING_MS - 60_000,
    })
    expect(getReclaimCandidate(run, USER, empty, now)).toEqual({
      runId: run.id,
      kind: 'original',
      token: PAYMENT_TOKEN,
    })
  })

  it('does not reclaim fresh pending runs', () => {
    const now = Date.now()
    const run = makeRun({
      status: 'pending',
      loomJobEvent: jobEventWithPayment(),
      createdAt: now - 60_000,
    })
    expect(getReclaimCandidate(run, USER, empty, now)).toBeNull()
  })

  it('returns null for in-flight runs', () => {
    for (const status of ['running', 'in_progress', 'queued'] satisfies WorkflowStatus[]) {
      const run = makeRun({status, loomJobEvent: jobEventWithPayment()})
      expect(getReclaimCandidate(run, USER, empty)).toBeNull()
    }
  })

  it('returns null when there is nothing to reclaim against', () => {
    const run = makeRun({status: 'failure'})
    expect(getReclaimCandidate(run, USER, empty)).toBeNull()
  })
})

describe('classifyReclaimError', () => {
  it.each([
    ['HTTP 429 Too Many Requests', 'rate_limit'],
    ['mint says rate-limit exceeded', 'rate_limit'],
    ['Rate Limit Exceeded', 'rate_limit'],
    ['proof already spent', 'already_spent'],
    ['TOKEN_ALREADY_SPENT', 'already_spent'],
    ['outputs already signed', 'already_spent'],
    ['network error', 'unknown'],
  ])('classifies %j as %s', (message, expected) => {
    expect(classifyReclaimError(new Error(message)).kind).toBe(expected)
  })

  it('accepts plain string errors', () => {
    expect(classifyReclaimError('429 from mint').kind).toBe('rate_limit')
  })

  it('falls back to unknown for non-error values', () => {
    expect(classifyReclaimError(undefined).kind).toBe('unknown')
    expect(classifyReclaimError({}).kind).toBe('unknown')
  })
})
