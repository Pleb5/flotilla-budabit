import {describe, expect, it} from 'vitest'
import {deliveryStatusLabel, runDeliveryState, WORKER_ACK_TIMEOUT_MS} from './run-delivery'
import {getReclaimCandidate, getUnacknowledgedReclaimCandidate} from './reclaim'
import type {NostrEvent, WorkflowRun} from './types'

const user = 'a'.repeat(64)
const job: NostrEvent = {id: 'job', pubkey: user, kind: 5100, created_at: 1000, content: '', tags: [['payment', 'fixture-token']]}
const run: WorkflowRun = {id: 'run', name: 'test', status: 'pending', actor: user, createdAt: 900_000, updatedAt: 900_000, branch: 'dev', commit: '', commitMessage: '', event: 'manual', loomJobEvent: job}
const now = job.created_at * 1000 + WORKER_ACK_TIMEOUT_MS

describe('worker acknowledgement and recovery', () => {
  it('distinguishes missing jobs, awaiting acknowledgement, and timed-out acknowledgement', () => {
    expect(runDeliveryState({...run, loomJobEvent: undefined}, now)).toBe('missing-job')
    expect(deliveryStatusLabel(run, now - 1)).toBe('Awaiting worker')
    expect(deliveryStatusLabel(run, now)).toBe('No response')
  })

  it('offers explicit recovery after five minutes without putting the job in automatic recovery', () => {
    expect(getReclaimCandidate(run, user, {}, now)).toBeNull()
    expect(getUnacknowledgedReclaimCandidate(run, user, {}, now - 1)).toBeNull()
    expect(getUnacknowledgedReclaimCandidate(run, user, {}, now)).toEqual({runId: run.id, kind: 'original', token: 'fixture-token', manualOnly: true})
    expect(getUnacknowledgedReclaimCandidate(run, 'other', {}, now)).toBeNull()
    expect(getUnacknowledgedReclaimCandidate(run, user, {[run.id]: {kind: 'original', tokenHash: 'hash', redeemedAt: now}}, now)).toBeNull()
    expect(getUnacknowledgedReclaimCandidate({...run, loomJobEvent: {...job, tags: []}}, user, {}, now)).toBeNull()
  })

  it('removes the timeout and manual recovery as soon as any authoritative response arrives', () => {
    for (const field of ['loomStatusEvent', 'loomResultEvent', 'workflowLogEvent'] as const) {
      const acknowledged = {...run, [field]: {...job, kind: 30100}}
      expect(runDeliveryState(acknowledged, now)).toBeNull()
      expect(getUnacknowledgedReclaimCandidate(acknowledged, user, {}, now)).toBeNull()
    }
    for (const status of ['queued', 'running', 'success', 'failure'] as const) {
      expect(getUnacknowledgedReclaimCandidate({...run, status}, user, {}, now)).toBeNull()
    }
  })
})
