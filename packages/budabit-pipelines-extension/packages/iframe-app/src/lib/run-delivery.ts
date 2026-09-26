import type {WorkflowRun} from './types'

export const WORKER_ACK_TIMEOUT_MS = 5 * 60 * 1000

export function runDeliveryState(run: WorkflowRun, now = Date.now()) {
  if (run.status !== 'pending' || run.loomStatusEvent || run.loomResultEvent || run.workflowLogEvent) return null
  if (!run.loomJobEvent) return 'missing-job'
  const submittedAt = run.loomJobEvent.created_at * 1000
  return now - submittedAt >= WORKER_ACK_TIMEOUT_MS ? 'unacknowledged' : 'awaiting-worker'
}

export function deliveryStatusLabel(run: WorkflowRun, now = Date.now()): string | null {
  switch (runDeliveryState(run, now)) {
    case 'missing-job': return 'Awaiting job'
    case 'awaiting-worker': return 'Awaiting worker'
    case 'unacknowledged': return 'No response'
    default: return null
  }
}
